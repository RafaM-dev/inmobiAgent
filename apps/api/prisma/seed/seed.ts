import { buildContainer, type AppCradle } from "../../src/bootstrap/container";
import { loadConfig } from "../../src/platform/config/env";
import { isErr } from "../../src/platform/result/result";
import { TenantContext } from "../../src/platform/tenancy/tenant-context";
import { channelsModule, ChannelType } from "../../src/modules/channels";
import { identityModule } from "../../src/modules/identity";
import { DocumentSourceType, knowledgeModule } from "../../src/modules/knowledge";
import { DEMO_DOCUMENTS } from "./demo-knowledge";

/**
 * Datos mínimos para tener un producto usable en desarrollo.
 *
 * Usa los MISMOS casos de uso que la API en producción, no SQL suelto: si una
 * invariante se rompe, el seed falla igual que fallaría un alta real. Un seed
 * que escribe directo en las tablas es un seed que miente sobre el sistema.
 *
 * Es idempotente: se puede ejecutar tantas veces como haga falta.
 */
const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  // `indexOf` devuelve -1 cuando la bandera no está, y `argv[0]` es la ruta de
  // Node: sin esta comprobación, el valor por defecto nunca se usaba y el slug
  // acababa siendo "C:\...\node.exe".
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ?? fallback;
};

/**
 * Parametrizable para poder levantar una SEGUNDA inmobiliaria y comprobar el
 * aislamiento entre tenants con datos reales:
 *   pnpm db:seed --slug otra-inmobiliaria --name "Otra" --account otra
 */
const DEMO = {
  slug: arg("slug", "inmobiliaria-demo"),
  name: arg("name", "Inmobiliaria Demo"),
  /** Identificador público de la sala de consola: se usa en la URL del CLI. */
  consoleAccountExternalId: arg("account", "demo"),
} as const;

const OWNER = {
  email: `asesor@${DEMO.slug}.co`,
  name: "Asesor Demo",
  /**
   * Contraseña de desarrollo. Es larga a propósito —el mínimo son diez
   * caracteres— y evidente: nadie debe confundirla con una real.
   */
  password: arg("password", "demo-inmobiliaria-2026"),
} as const;

/**
 * Documentación de la inmobiliaria, ingerida e indexada.
 *
 * El indexado se llama a mano porque el seed no levanta el bus de eventos. En
 * la aplicación real lo dispara `knowledge.document_ingested`; aquí se encadena
 * para que al terminar el seed las preguntas ya tengan respuesta.
 */
const seedKnowledge = async (cradle: AppCradle): Promise<void> => {
  let indexed = 0;

  for (const document of DEMO_DOCUMENTS) {
    const collection = await cradle.createCollection.execute({ name: document.collection });
    if (isErr(collection)) throw collection.error;

    const ingested = await cradle.ingestDocument.execute({
      collectionId: collection.value.id,
      title: document.title,
      sourceType: DocumentSourceType.TEXT,
      mimeType: "text/markdown",
      content: document.text,
    });
    if (isErr(ingested)) throw ingested.error;

    const result = await cradle.indexDocument.execute(ingested.value.documentId);
    if (isErr(result)) throw result.error;

    indexed += 1;
  }

  console.log(`✔ Base de conocimiento lista: ${String(indexed)} documentos indexados`);
};

/**
 * Cuenta de WhatsApp de pruebas. Solo si se pide con `--whatsapp <id>`.
 *
 * El `phone_number_id` es la identidad de la cuenta en Meta y lo que resuelve
 * la inmobiliaria cuando llega un webhook. El token de acceso se guarda CIFRADO
 * en la propia cuenta: es de ese número, no de la plataforma.
 */
const seedWhatsApp = async (cradle: AppCradle): Promise<void> => {
  const phoneNumberId = arg("whatsapp", "");
  if (phoneNumberId.length === 0) return;

  const account = await cradle.registerChannelAccount.execute({
    channelType: ChannelType.WHATSAPP,
    externalId: phoneNumberId,
    displayName: `WhatsApp ${phoneNumberId}`,
  });
  if (isErr(account)) throw account.error;

  const stored = await cradle.channelCredentials.set(account.value.id, {
    accessToken: arg("whatsapp-token", "token-de-pruebas"),
  });
  if (isErr(stored)) throw stored.error;

  console.log(`✔ Cuenta de WhatsApp lista: ${phoneNumberId} (credenciales cifradas)`);
};

const main = async (): Promise<void> => {
  const config = loadConfig();
  const container = buildContainer(config);

  identityModule.registerDependencies(container);
  channelsModule.registerDependencies(container);
  knowledgeModule.registerDependencies(container);

  const cradle = container.cradle;
  await cradle.database.connect();

  try {
    let tenant = await cradle.tenantDirectory.findBySlug(DEMO.slug);

    if (tenant) {
      console.log(`· El tenant "${DEMO.slug}" ya existía (${tenant.id})`);
    } else {
      const created = await cradle.createTenant.execute({
        slug: DEMO.slug,
        name: DEMO.name,
        plan: "PRO",
        settings: {
          agentDisplayName: "Sofía",
          tone: "CERCANO",
          welcomeMessage: `¡Hola! Soy Sofía, de ${DEMO.name}. ¿En qué te puedo ayudar?`,
          handoffEmail: OWNER.email,
        },
        owner: { email: OWNER.email, displayName: OWNER.name },
      });

      if (isErr(created)) throw created.error;
      tenant = created.value;
      console.log(`✔ Tenant creado: ${tenant.name} (${tenant.id})`);
    }

    // La contraseña se fija siempre, también si el tenant ya existía: así el
    // seed sirve para recuperar el acceso en desarrollo.
    const password = await cradle.setUserPassword.execute({
      tenantId: tenant.id,
      email: OWNER.email,
      password: OWNER.password,
    });
    if (isErr(password)) throw password.error;
    console.log(`✔ Acceso al back-office: ${OWNER.email} / ${OWNER.password}`);

    // La cuenta de canal se crea dentro del contexto del tenant: el repositorio
    // comprueba que el agregado pertenece al tenant en curso.
    await TenantContext.run(
      { tenantId: tenant.id, correlationId: "seed", source: "cli" },
      async () => {
        const account = await cradle.registerChannelAccount.execute({
          channelType: ChannelType.CONSOLE,
          externalId: DEMO.consoleAccountExternalId,
          displayName: "Consola de desarrollo",
        });

        if (isErr(account)) throw account.error;
        console.log(`✔ Cuenta de canal lista: CONSOLE/${account.value.externalId}`);

        await seedKnowledge(cradle);
        await seedWhatsApp(cradle);
      },
    );

    console.log("\nListo. Habla con el producto:\n  pnpm chat\n");
  } finally {
    await cradle.database.disconnect();
  }
};

main().catch((error: unknown) => {
  console.error("Fallo el seed:", error instanceof Error ? error.message : error);
  process.exit(1);
});

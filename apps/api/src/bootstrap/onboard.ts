import { Application } from "./application";
import { loadConfig } from "../platform/config/env";
import { ChannelType } from "../modules/channels";
import { isErr } from "../platform/result/result";
import { TenantContext } from "../platform/tenancy/tenant-context";

/**
 * Alta de una inmobiliaria en un despliegue real.
 *
 * Es el paso que faltaba para poder entrar en lo que se acaba de desplegar:
 * `db:seed` corre con `tsx` y datos de demostración, y ninguna de las dos cosas
 * existe en la imagen de producción.
 *
 *   fly ssh console -C "node /app/apps/api/dist/onboard.js \
 *     --slug alfa --nombre 'Alfa Propiedades' \
 *     --correo maria@alfa.co --propietario 'María Restrepo'"
 *
 * **No recibe ninguna contraseña, y es deliberado.** Emite un enlace de
 * invitación y lo imprime; la persona elige su contraseña en el navegador. Una
 * contraseña pasada por línea de comandos queda en el historial del intérprete,
 * en los registros del orquestador y en la memoria de quien mire la pantalla.
 *
 * Es repetible: si la inmobiliaria ya existe no falla, vuelve a emitir el
 * enlace del propietario. Eso lo convierte además en la vía de recuperación
 * cuando alguien se queda fuera y no hay correo configurado.
 */

interface Args {
  slug?: string;
  nombre?: string;
  correo?: string;
  propietario?: string;
  zona?: string;
  moneda?: string;
}

const parseArgs = (argv: readonly string[]): Args => {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag?.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[flag.slice(2) as keyof Args] = next;
        i += 1;
      }
    }
  }
  return args;
};

const USAGE = `
Alta de una inmobiliaria.

  node dist/onboard.js --slug <id> --nombre <nombre> --correo <email> --propietario <nombre>

  --slug          Identificador corto; es lo que se escribe al entrar al panel.
  --nombre        Nombre visible de la inmobiliaria.
  --correo        Correo del propietario. Recibe el enlace de acceso.
  --propietario   Nombre de esa persona.
  --zona          Zona horaria. Por defecto America/Bogota.
  --moneda        Código de 3 letras. Por defecto COP.
`;

const run = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  if (!args.slug || !args.nombre || !args.correo || !args.propietario) {
    process.stderr.write(`${USAGE}\n`);
    process.exit(64); // EX_USAGE
  }

  // Ya validados: a partir de aquí son cadenas, y el resto del archivo se lee
  // sin un `?? ""` en cada uso.
  const { slug, nombre, correo, propietario } = args;

  /*
   * Se arranca la aplicación con el rol `worker`: no hace falta servidor HTTP
   * para dar de alta a nadie, y abrir un puerto desde un comando puntual
   * chocaría con el proceso que ya está sirviendo tráfico.
   */
  const app = new Application({ config: loadConfig(), role: "worker", listen: false });
  await app.start();

  try {
    const cradle = app.cradle;
    const existing = await cradle.tenantDirectory.findBySlug(slug);

    let tenantId: string;
    let tenantName: string;

    if (existing) {
      process.stdout.write(`· "${slug}" ya existía. Se vuelve a emitir el enlace.\n`);
      tenantId = existing.id;
      tenantName = existing.name;
    } else {
      const created = await cradle.createTenant.execute({
        slug,
        name: nombre,
        timezone: args.zona ?? "America/Bogota",
        currency: args.moneda ?? "COP",
        settings: {
          agentDisplayName: "Asistente",
          tone: "CERCANO",
          // El correo del propietario recibe los avisos de escalado hasta que
          // alguien configure otro. Dejarlo vacío significaría que las
          // conversaciones que el agente pasa a una persona no avisan a nadie.
          handoffEmail: correo,
        },
        owner: { email: correo, displayName: propietario },
      });
      if (isErr(created)) throw created.error;

      tenantId = created.value.id;
      tenantName = created.value.name;
      process.stdout.write(`✔ Inmobiliaria creada: ${tenantName} (${tenantId})\n`);
    }

    await TenantContext.run(
      { tenantId, correlationId: `onboard-${slug}`, source: "cli" },
      async () => {
        // El canal de consola es lo que hace funcionar el simulador del panel.
        // Sin él, la inmobiliaria no puede probar su agente antes de conectar
        // WhatsApp — que es justo lo primero que va a querer hacer.
        const account = await cradle.registerChannelAccount.execute({
          channelType: ChannelType.CONSOLE,
          externalId: `consola-${slug}`,
          displayName: "Simulador",
        });
        if (isErr(account)) throw account.error;

        const owner = await cradle.userRepository.findByEmail(correo);
        if (!owner) throw new Error("La inmobiliaria se creó sin propietario");

        const link = await cradle.invitationMailer.issue({
          user: owner,
          purpose: "INVITATION",
          tenantName,
          tenantSlug: slug,
        });

        process.stdout.write(
          link.delivered
            ? `✔ Enlace de acceso enviado a ${correo}\n`
            : `\n⚠ Sin correo configurado: el enlace NO se ha enviado.\n` +
                `  Pásaselo tú a ${correo} — caduca en 7 días y solo sirve una vez:\n\n` +
                `  ${link.url}\n\n`,
        );
      },
    );

    process.stdout.write(`\nEntrar en el panel con la inmobiliaria "${slug}".\n`);
  } finally {
    await app.stop();
  }
};

run().catch((error: unknown) => {
  process.stderr.write(
    `\nNo se pudo dar de alta: ${error instanceof Error ? error.message : String(error)}\n\n`,
  );
  process.exit(1);
});

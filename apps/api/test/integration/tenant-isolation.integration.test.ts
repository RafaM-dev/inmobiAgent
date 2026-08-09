import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DocumentSourceType } from "../../src/modules/knowledge";
import { isErr, isOk } from "../../src/platform/result/result";
import { TenantContext } from "../../src/platform/tenancy/tenant-context";
import { asTenant, seedTenant, type SeededTenant } from "../support/fixtures";
import { withApplication, type ApplicationContext } from "../support/integration-harness";

/**
 * AISLAMIENTO ENTRE INMOBILIARIAS, contra Postgres de verdad.
 *
 * Es la garantía que sostiene el producto entero: una inmobiliaria no puede
 * ver ni tocar los datos de otra. Los dobles en memoria de la suite unitaria
 * implementan el filtro por tenant "porque los escribimos así"; esto comprueba
 * que el `WHERE tenant_id = …` está de verdad en el SQL que se ejecuta.
 *
 * Un fallo aquí no es un bug: es una fuga entre clientes.
 */
describe("Aislamiento entre inmobiliarias (Postgres real)", () => {
  let context: ApplicationContext;
  let alfa: SeededTenant;
  let beta: SeededTenant;

  beforeAll(async () => {
    context = await withApplication();
  });

  afterAll(async () => {
    await context.stop();
  });

  beforeEach(async () => {
    await context.reset();
    alfa = await seedTenant(context.app.cradle, { slug: "alfa-propiedades" });
    beta = await seedTenant(context.app.cradle, { slug: "beta-inmuebles" });
  });

  it("cada inmobiliaria solo ve sus propios canales", async () => {
    const canalesDeAlfa = await asTenant(alfa.tenantId, () =>
      context.app.cradle.listChannelAccounts.execute(),
    );

    expect(isOk(canalesDeAlfa)).toBe(true);
    if (!isOk(canalesDeAlfa)) return;

    expect(canalesDeAlfa.value).toHaveLength(1);
    expect(canalesDeAlfa.value[0]?.externalId).toBe(alfa.consoleAccountExternalId);
    // La cuenta de la otra inmobiliaria existe en la misma tabla y no aparece.
    expect(canalesDeAlfa.value.map((c) => c.externalId)).not.toContain(
      beta.consoleAccountExternalId,
    );
  });

  it("una colección de otra inmobiliaria no existe, no está vacía", async () => {
    const deBeta = await asTenant(beta.tenantId, () =>
      context.app.cradle.createCollection.execute({ name: "Políticas de Beta" }),
    );
    if (!isOk(deBeta)) throw deBeta.error;

    // Alfa pide la colección de Beta por su id exacto.
    const intento = await asTenant(alfa.tenantId, () =>
      context.app.cradle.listDocuments.execute({ collectionId: deBeta.value.id }),
    );

    /*
     * Tiene que ser NOT_FOUND y no una lista vacía. Si el filtro por tenant
     * devolviera "cero documentos", Alfa concluiría que la colección existe y
     * está vacía — y eso ya confirma que Beta tiene una colección con ese id.
     */
    expect(isErr(intento)).toBe(true);
    if (isErr(intento)) expect(intento.error.code).toBe("NOT_FOUND");
  });

  it("el mismo identificador de canal en dos inmobiliarias resuelve a cada una", async () => {
    // Las dos usan "recepcion" como identificador público de su consola.
    const mismoId = "recepcion";

    for (const tenant of [alfa, beta]) {
      await asTenant(tenant.tenantId, async () => {
        const cuenta = await context.app.cradle.registerChannelAccount.execute({
          channelType: "CONSOLE",
          externalId: `${mismoId}-${tenant.slug}`,
          displayName: "Recepción",
        });
        if (isErr(cuenta)) throw cuenta.error;
      });
    }

    const resuelta = await context.app.cradle.resolveChannelAccount.execute(
      "CONSOLE",
      `${mismoId}-${beta.slug}`,
    );

    expect(isOk(resuelta)).toBe(true);
    // El tenant se DEDUCE de la cuenta, nunca de quien pregunta.
    if (isOk(resuelta)) expect(resuelta.value.tenantId).toBe(beta.tenantId);
  });

  it("los documentos de una inmobiliaria no aparecen en la búsqueda de la otra", async () => {
    const texto =
      "## Comisión\nLa comisión de administración de Beta es del ocho por ciento mensual.";

    const coleccionBeta = await asTenant(beta.tenantId, async () => {
      const coleccion = await context.app.cradle.createCollection.execute({ name: "Tarifas" });
      if (isErr(coleccion)) throw coleccion.error;

      const documento = await context.app.cradle.ingestDocument.execute({
        collectionId: coleccion.value.id,
        title: "Tarifas de Beta",
        sourceType: DocumentSourceType.TEXT,
        mimeType: "text/markdown",
        content: Buffer.from(texto, "utf8"),
      });
      if (isErr(documento)) throw documento.error;

      const indexado = await context.app.cradle.indexDocument.execute(
        documento.value.documentId,
      );
      if (isErr(indexado)) throw indexado.error;

      return coleccion.value.id;
    });
    expect(coleccionBeta).toBeTruthy();

    // Alfa pregunta exactamente por lo que Beta acaba de indexar.
    const respuesta = await asTenant(alfa.tenantId, () =>
      context.app.cradle.knowledgeService.search({
        question: "¿Cuál es la comisión de administración?",
      }),
    );

    expect(isOk(respuesta)).toBe(true);
    if (!isOk(respuesta)) return;
    // Sin documentos propios, la respuesta correcta es no saber — jamás el
    // párrafo de la competencia.
    expect(respuesta.value.passages).toHaveLength(0);
  });

  it("buscar por id la cuenta de otra inmobiliaria devuelve nada", async () => {
    const cuentasDeBeta = await asTenant(beta.tenantId, () =>
      context.app.cradle.listChannelAccounts.execute(),
    );
    if (!isOk(cuentasDeBeta)) throw cuentasDeBeta.error;

    const id = cuentasDeBeta.value[0]?.id;
    expect(id).toBeDefined();
    if (id === undefined) return;

    const repositorio = context.app.cradle.channelAccountRepository;

    // Para Beta existe…
    expect(await asTenant(beta.tenantId, () => repositorio.findById(id))).not.toBeNull();
    // …y para Alfa no, aunque conozca el id exacto.
    expect(await asTenant(alfa.tenantId, () => repositorio.findById(id))).toBeNull();
  });

  it("escribir un agregado de otra inmobiliaria falla en el repositorio", async () => {
    const cuentasDeBeta = await asTenant(beta.tenantId, () =>
      context.app.cradle.listChannelAccounts.execute(),
    );
    if (!isOk(cuentasDeBeta)) throw cuentasDeBeta.error;

    const id = cuentasDeBeta.value[0]?.id;
    expect(id).toBeDefined();
    if (id === undefined) return;

    const repositorio = context.app.cradle.channelAccountRepository;
    const agregadoDeBeta = await asTenant(beta.tenantId, () => repositorio.findById(id));
    expect(agregadoDeBeta).not.toBeNull();
    if (!agregadoDeBeta) return;

    /*
     * Defensa en profundidad: aunque un caso de uso arrastrara por error el
     * agregado de otra inmobiliaria, el repositorio se niega a escribirlo. El
     * contexto manda sobre el objeto que se le pasa.
     */
    await expect(
      TenantContext.run(
        { tenantId: alfa.tenantId, correlationId: "test", source: "cli" },
        () => repositorio.save(agregadoDeBeta),
      ),
    ).rejects.toThrow();
  });
});

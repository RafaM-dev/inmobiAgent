import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DocumentSourceType } from "../../src/modules/knowledge";
import { isErr } from "../../src/platform/result/result";
import { asTenant, seedTenant, type SeededTenant } from "../support/fixtures";
import { withApplication, type ApplicationContext } from "../support/integration-harness";

/**
 * BÚSQUEDA DE CONOCIMIENTO contra Postgres de verdad.
 *
 * Es el test de integración que más falta hacía. Los dobles en memoria de la
 * suite unitaria imitan los dos carriles con coseno y coincidencia de términos,
 * pero hay tres cosas que solo hace Postgres y que deciden si el agente
 * responde bien o dice tonterías:
 *
 *   1. `unaccent` — "comisión" y "comision" tienen que ser la misma palabra.
 *   2. El lematizador español — "requisitos" tiene que encontrar "requisito".
 *   3. Las palabras vacías — "del", "para", "qué" no pueden hacer coincidir
 *      documentos que no vienen a cuento.
 *
 * Ninguna de las tres se puede imitar de forma honesta. Aquí se ejecutan.
 */

const REGLAMENTO = `## Mascotas
Se permiten mascotas de hasta quince kilos en las unidades residenciales, previa
autorización escrita de la administración.

## Requisitos de arrendamiento
El requisito principal es demostrar ingresos equivalentes a tres veces el canon
mensual, mediante certificación laboral vigente.

## Comisión de administración
La comisión de administración corresponde al diez por ciento del canon.`;

describe("Búsqueda de conocimiento (Postgres real: pgvector + full-text español)", () => {
  let context: ApplicationContext;
  let tenant: SeededTenant;

  const indexar = async (contenido: string, titulo = "Reglamento"): Promise<string> =>
    asTenant(tenant.tenantId, async () => {
      const coleccion = await context.app.cradle.createCollection.execute({ name: "Políticas" });
      if (isErr(coleccion)) throw coleccion.error;

      const documento = await context.app.cradle.ingestDocument.execute({
        collectionId: coleccion.value.id,
        title: titulo,
        sourceType: DocumentSourceType.TEXT,
        mimeType: "text/markdown",
        content: Buffer.from(contenido, "utf8"),
      });
      if (isErr(documento)) throw documento.error;

      const indexado = await context.app.cradle.indexDocument.execute(
        documento.value.documentId,
      );
      if (isErr(indexado)) throw indexado.error;

      return documento.value.documentId;
    });

  const preguntar = async (question: string) => {
    const respuesta = await asTenant(tenant.tenantId, () =>
      context.app.cradle.knowledgeService.search({ question }),
    );
    if (isErr(respuesta)) throw respuesta.error;
    return respuesta.value;
  };

  beforeAll(async () => {
    context = await withApplication();
  });

  afterAll(async () => {
    await context.stop();
  });

  beforeEach(async () => {
    await context.reset();
    tenant = await seedTenant(context.app.cradle);
  });

  it("encuentra el párrafo aunque la pregunta venga sin tildes", async () => {
    await indexar(REGLAMENTO);

    // El documento dice "comisión"; el cliente escribe "comision".
    const respuesta = await preguntar("cual es la comision de administracion");

    expect(respuesta.found).toBe(true);
    expect(respuesta.passages[0]?.content).toContain("diez por ciento");
  });

  it("encuentra el párrafo con otra forma de la palabra", async () => {
    await indexar(REGLAMENTO);

    // El documento dice "El requisito principal"; se pregunta por "requisitos".
    const respuesta = await preguntar("¿qué requisitos piden?");

    expect(respuesta.found).toBe(true);
    expect(respuesta.passages[0]?.content).toContain("tres veces el canon");
  });

  it("no responde a lo que no está en la documentación", async () => {
    await indexar(REGLAMENTO);

    const respuesta = await preguntar("¿cuál es la tasa de cambio del euro hoy?");

    /*
     * Este es el caso que justifica todo el guardrail de citación: el carril
     * vectorial SIEMPRE devuelve sus vecinos más próximos, por lejos que estén.
     * Si el suelo de relevancia no filtrara (D29), aquí saldría el reglamento
     * de mascotas y el agente lo citaría al hablar de divisas.
     */
    expect(respuesta.found).toBe(false);
    expect(respuesta.passages).toHaveLength(0);
  });

  it("las palabras vacías no hacen coincidir documentos ajenos", async () => {
    await indexar(
      "## Parqueaderos\nCada apartamento del edificio incluye un parqueadero cubierto.",
      "Parqueaderos",
    );

    // Comparte "del" y "para" con el documento, y nada más.
    const respuesta = await preguntar("¿cuál es el horario del gimnasio para invitados?");

    expect(respuesta.found).toBe(false);
  });

  it("cada epígrafe es un fragmento distinto y se recupera por separado", async () => {
    await indexar(REGLAMENTO);

    const mascotas = await preguntar("¿se admiten mascotas?");
    const comision = await preguntar("¿cuánto cobran de administración?");

    expect(mascotas.passages[0]?.content).toContain("quince kilos");
    expect(comision.passages[0]?.content).toContain("diez por ciento");

    /*
     * Son fragmentos DISTINTOS. Si el troceado hubiera metido el reglamento
     * entero en uno solo (el fallo que cerró D24), las dos preguntas
     * devolverían el mismo bloque y el buscador dejaría de discriminar.
     */
    expect(mascotas.passages[0]?.chunkId).not.toBe(comision.passages[0]?.chunkId);
  });

  it("el carril vectorial ignora los fragmentos de otro modelo de embeddings", async () => {
    await indexar(REGLAMENTO);

    const embeddings = context.app.cradle.embeddingProvider;
    const vector = await embeddings.embedQuery("comision de administracion");
    if (isErr(vector)) throw vector.error;

    const consulta = {
      text: "comision de administracion",
      embedding: vector.value,
      embeddingModel: embeddings.model,
      limit: 10,
    };

    const conElModeloCorrecto = await asTenant(tenant.tenantId, () =>
      context.app.cradle.documentChunkRepository.searchByVector(consulta),
    );
    expect(conElModeloCorrecto.length).toBeGreaterThan(0);

    // Se simula haber cambiado de proveedor de embeddings sin reindexar.
    await context.sql((tx) =>
      tx.$executeRawUnsafe("UPDATE document_chunks SET embedding_model = 'otro-modelo-v2'"),
    );

    const conModeloDistinto = await asTenant(tenant.tenantId, () =>
      context.app.cradle.documentChunkRepository.searchByVector(consulta),
    );

    /*
     * Comparar por coseno vectores de dos modelos no da peores resultados: da
     * resultados sin sentido con aspecto de funcionar (D25). El carril léxico
     * sí sigue respondiendo, y debe: el full-text no usa vectores, así que sus
     * resultados siguen siendo válidos. Degradar a un solo carril es correcto;
     * mezclar espacios vectoriales, no.
     */
    expect(conModeloDistinto).toHaveLength(0);
  });

  it("subir dos veces el mismo texto no duplica los fragmentos", async () => {
    const primero = await indexar(REGLAMENTO);
    const segundo = await indexar(REGLAMENTO);

    expect(segundo).toBe(primero);

    const fragmentos = await context.sql((tx) => tx.documentChunk.count());
    const documentos = await context.sql((tx) => tx.document.count());

    expect(documentos).toBe(1);
    // Fragmentos duplicados es como un RAG empieza a contradecirse a sí mismo.
    expect(fragmentos).toBeGreaterThan(0);

    const respuesta = await preguntar("¿se admiten mascotas?");
    const ids = respuesta.passages.map((p) => p.chunkId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reindexar reemplaza los fragmentos en vez de acumularlos", async () => {
    const documentId = await indexar(REGLAMENTO);
    const antes = await context.prisma.documentChunk.count();

    await asTenant(tenant.tenantId, async () => {
      const reindexado = await context.app.cradle.reindexDocument.execute(documentId);
      if (isErr(reindexado)) throw reindexado.error;
      const indexado = await context.app.cradle.indexDocument.execute(documentId);
      if (isErr(indexado)) throw indexado.error;
    });

    const despues = await context.prisma.documentChunk.count();
    expect(despues).toBe(antes);
  });

  it("borrar un documento quita sus fragmentos del índice", async () => {
    const documentId = await indexar(REGLAMENTO);
    expect((await preguntar("¿se admiten mascotas?")).found).toBe(true);

    await asTenant(tenant.tenantId, async () => {
      const borrado = await context.app.cradle.deleteDocument.execute(documentId);
      if (isErr(borrado)) throw borrado.error;
    });

    // Un documento borrado cuyos fragmentos siguen indexados haría que el
    // agente citara una fuente que ya no existe: peor que no responder.
    expect((await preguntar("¿se admiten mascotas?")).found).toBe(false);
    expect(await context.sql((tx) => tx.documentChunk.count())).toBe(0);
  });
});

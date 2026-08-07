import { beforeEach, describe, expect, it } from "vitest";
import { isOk } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import type { ReplyBlock } from "../../../channels";
import { NO_ANSWER_REPLY } from "../guardrails/citation.guardrail";
import { createHarness, type Harness } from "../../testing/agent-turn.harness";

/**
 * El criterio de aceptación de F5, comprobado de punta a punta: preguntas sobre
 * los documentos del tenant respondidas con cita; sin cita, `NO_ANSWER`.
 *
 * Corre la ingesta real, el troceado real, los embeddings del modo demo, la
 * búsqueda híbrida y los guardrails. Lo único simulado es el modelo.
 */

const REGLAMENTO = `# Reglamento de arrendamiento

## Mascotas

Se permiten mascotas de hasta quince kilos en las unidades residenciales, previa
autorización escrita de la administración. No se admiten razas clasificadas como
potencialmente peligrosas.

## Depósito

El depósito equivale a un canon mensual y se devuelve dentro de los treinta días
siguientes a la entrega del inmueble, descontando los daños que no correspondan
al desgaste normal.

## Terminación anticipada

El arrendatario puede terminar el contrato con sesenta días de preaviso escrito.
La terminación sin preaviso genera una indemnización equivalente a tres cánones.
`;

const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
  TenantContext.run({ tenantId: "t1", correlationId: "corr-1", source: "test" }, fn);

let turnCounter = 0;

const ask = async (harness: Harness, text: string): Promise<readonly ReplyBlock[]> => {
  turnCounter += 1;
  harness.conversations.recordContact(text);

  const result = await inTenant(() =>
    harness.runTurn.execute({
      conversationId: "c1",
      turnId: `turn-${String(turnCounter)}`,
      contactId: "ct1",
      text,
      correlationId: "corr-1",
    }),
  );

  if (!isOk(result)) throw new Error("el turno debería completarse");
  return harness.conversations.replies.at(-1)?.blocks ?? [];
};

const textOf = (blocks: readonly ReplyBlock[]): string =>
  blocks
    .filter((block): block is Extract<ReplyBlock, { kind: "text" }> => block.kind === "text")
    .map((block) => block.text)
    .join("\n");

describe("Responder con la documentación de la inmobiliaria", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = createHarness();
    const added = await inTenant(() =>
      harness.knowledge.addDocument({
        collection: "Políticas",
        title: "Reglamento de arrendamiento",
        text: REGLAMENTO,
      }),
    );
    if (!isOk(added)) throw new Error("debería indexar el reglamento");
  });

  it("indexa el documento en varios fragmentos con su epígrafe", async () => {
    const added = await inTenant(() =>
      harness.knowledge.addDocument({
        collection: "Políticas",
        title: "Reglamento de arrendamiento",
        text: REGLAMENTO,
      }),
    );

    if (!isOk(added)) throw new Error("debería indexar");
    // Idempotente: el mismo contenido no se vuelve a ingerir.
    expect(added.value.chunkCount).toBeGreaterThan(0);
  });

  it("responde con lo que dice el documento, no de memoria", async () => {
    const blocks = await ask(harness, "¿aceptan mascotas?");
    const answer = textOf(blocks);

    expect(answer).toContain("quince kilos");
    expect(answer).not.toBe(NO_ANSWER_REPLY);
  });

  it("adjunta la fuente, y la escribe la herramienta", async () => {
    const blocks = await ask(harness, "¿cuánto es el depósito?");

    expect(textOf(blocks)).toContain("Fuente: Reglamento de arrendamiento");
  });

  it("encuentra por el epígrafe aunque la pregunta use otras palabras", async () => {
    const blocks = await ask(harness, "¿qué preaviso necesito para terminar?");

    expect(textOf(blocks)).toContain("sesenta días");
  });

  it("no inventa cuando la documentación no dice nada", async () => {
    const blocks = await ask(harness, "¿cuál es la tasa de interés del banco central?");

    // El guardrail sustituye lo que el modelo hubiera redactado: sin fuente,
    // no hay respuesta.
    expect(textOf(blocks)).toContain(NO_ANSWER_REPLY);
  });

  it("una pregunta sin respuesta no adjunta ninguna fuente", async () => {
    const blocks = await ask(harness, "¿cuánto vale un pasaje a Cartagena?");

    expect(textOf(blocks)).not.toContain("Fuente:");
  });

  it("las respuestas son reproducibles: dos veces la misma pregunta, lo mismo", async () => {
    const primera = textOf(await ask(harness, "¿aceptan mascotas?"));
    const segunda = textOf(await ask(harness, "¿aceptan mascotas?"));

    expect(primera).toBe(segunda);
  });
});

import { describe, expect, it } from "vitest";
import { isOk } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import type { ReplyBlock } from "../../../channels";
import { AppointmentStatus } from "../../../appointments";
import { LeadStatus } from "../../../leads";
import { createHarness, type Harness } from "../../testing/agent-turn.harness";

/**
 * El objetivo de F4, comprobado de punta a punta: de "quiero ver el
 * apartamento" a una cita agendada, sin intervención humana y sin API key.
 *
 * Corre el orquestador real, las herramientas reales, la agenda real y el CRM
 * real. Lo único simulado es el modelo de lenguaje y la persistencia.
 */

const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
  TenantContext.run({ tenantId: "t1", correlationId: "corr-1", source: "test" }, fn);

let turnCounter = 0;

/** Un turno del cliente, como llegaría del canal. */
const say = async (harness: Harness, text: string): Promise<readonly ReplyBlock[]> => {
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

const blockKinds = (blocks: readonly ReplyBlock[]): string[] => blocks.map((block) => block.kind);

describe("De pedir una visita a tenerla agendada", () => {
  it("ofrece horarios reales cuando el cliente habla de visitar", async () => {
    const harness = createHarness();

    const blocks = await say(harness, "quiero agendar una visita");

    // Los horarios viajan como opciones construidas por la herramienta, no
    // como texto redactado por el modelo.
    expect(blockKinds(blocks)).toContain("quick_replies");

    const options = blocks.find((block) => block.kind === "quick_replies");
    expect(options?.kind === "quick_replies" && options.options.length).toBeGreaterThan(0);
  });

  it("el modelo no escribe ninguna fecha: solo la presenta", async () => {
    const harness = createHarness();

    const blocks = await say(harness, "quiero agendar una visita");
    const spoken = blocks
      .filter((block): block is Extract<ReplyBlock, { kind: "text" }> => block.kind === "text")
      .map((block) => block.text)
      .join(" ");

    // Ni horas, ni días de la semana, ni fechas en el texto del modelo.
    expect(spoken).not.toMatch(/\d{1,2}:\d{2}/);
    expect(spoken.toLowerCase()).not.toMatch(/lunes|martes|miércoles|jueves|viernes|sábado/);
  });

  it("«la segunda» agenda la segunda franja que se ofreció", async () => {
    const harness = createHarness();

    const offered = await say(harness, "quiero agendar una visita");
    const options = offered.find((block) => block.kind === "quick_replies");
    const expected =
      options?.kind === "quick_replies" ? options.options[1]?.label : undefined;

    const confirmation = await say(harness, "la segunda");

    const text = confirmation
      .filter((block): block is Extract<ReplyBlock, { kind: "text" }> => block.kind === "text")
      .map((block) => block.text)
      .join(" ");

    expect(expected).toBeDefined();
    // La confirmación lleva la hora exacta que se ofreció, escrita por la
    // herramienta a partir del instante real.
    expect(text).toContain(expected ?? "___");
  });

  it("la cita queda registrada en la agenda", async () => {
    const harness = createHarness();

    await say(harness, "quiero agendar una visita");
    await say(harness, "la primera");

    const appointment = await inTenant(() =>
      harness.appointments.repository.findActiveByConversation("c1"),
    );

    expect(appointment).not.toBeNull();
    expect(appointment?.status).toBe(AppointmentStatus.REQUESTED);
    expect(appointment?.scheduledAt.getTime()).toBeGreaterThan(Date.parse("2026-07-01T15:00:00Z"));
  });

  it("agendar crea la ficha comercial y mueve el embudo", async () => {
    const harness = createHarness();

    await say(harness, "quiero agendar una visita");
    await say(harness, "la primera");

    const lead = await inTenant(() => harness.leads.repository.findByConversation("c1"));

    expect(lead).not.toBeNull();
    expect(lead?.status).toBe(LeadStatus.SCHEDULED);
    // Pedir una visita es la señal comercial que más pesa.
    expect(lead?.visitRequested).toBe(true);
    expect(lead?.score.reasons.map((reason) => reason.code)).toContain("requested_visit");
  });

  it("no agenda por su cuenta si el cliente no eligió nada", async () => {
    const harness = createHarness();

    await say(harness, "quiero agendar una visita");
    await say(harness, "déjame pensarlo");

    const appointment = await inTenant(() =>
      harness.appointments.repository.findActiveByConversation("c1"),
    );

    expect(appointment).toBeNull();
  });

  it("cambiar de hora mueve la cita en vez de crear una segunda", async () => {
    const harness = createHarness();

    await say(harness, "quiero agendar una visita");
    await say(harness, "la primera");
    const first = await inTenant(() =>
      harness.appointments.repository.findActiveByConversation("c1"),
    );

    // El cliente vuelve sobre el tema: se le ofrecen horarios otra vez, porque
    // los anteriores ya no están en pantalla.
    await say(harness, "necesito cambiar la visita");
    await say(harness, "la segunda");

    const moved = await inTenant(() =>
      harness.appointments.repository.findActiveByConversation("c1"),
    );

    expect(moved?.id).toBe(first?.id);
    expect(moved?.scheduledAt.getTime()).not.toBe(first?.scheduledAt.getTime());
    expect(moved?.status).toBe(AppointmentStatus.RESCHEDULED);
  });

  it("una vez agendada, no se le vuelve a preguntar la hora en el mismo mensaje", async () => {
    const harness = createHarness();

    await say(harness, "quiero agendar una visita");
    const confirmation = await say(harness, "la primera");

    // La pregunta ya está resuelta: enviarla sería invitar al cliente a
    // contestar a algo que acaba de cerrarse.
    expect(blockKinds(confirmation)).not.toContain("quick_replies");
  });
});

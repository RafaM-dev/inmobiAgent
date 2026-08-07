import { describe, expect, it } from "vitest";
import { classifyIntent, Intent } from "../value-objects/intent";
import { decideEscalation, HandoffReason, type EscalationSignals } from "./escalation.policy";

const signals = (overrides: Partial<EscalationSignals> = {}): EscalationSignals => ({
  intent: Intent.SEARCH,
  consecutiveFailedTurns: 0,
  maxConsecutiveFailedTurns: 2,
  providerFailed: false,
  guardrailBlocked: false,
  budgetExhausted: false,
  ...overrides,
});

describe("classifyIntent", () => {
  it("reconoce la petición explícita de un humano por encima de todo lo demás", () => {
    expect(classifyIntent("busco apartamento pero quiero hablar con una persona")).toBe(
      Intent.HANDOFF,
    );
  });

  it("detecta temas fuera de alcance", () => {
    expect(classifyIntent("necesito un abogado para la escritura")).toBe(Intent.OUT_OF_SCOPE);
    expect(classifyIntent("quiero poner una queja")).toBe(Intent.OUT_OF_SCOPE);
    expect(classifyIntent("me hacen un descuento?")).toBe(Intent.OUT_OF_SCOPE);
  });

  it("distingue agendar de buscar", () => {
    expect(classifyIntent("quiero agendar una visita")).toBe(Intent.SCHEDULE);
    expect(classifyIntent("busco apartamento en Laureles")).toBe(Intent.SEARCH);
  });

  it("un saludo con contenido no es un saludo", () => {
    expect(classifyIntent("hola")).toBe(Intent.GREETING);
    expect(classifyIntent("Buenas tardes")).toBe(Intent.GREETING);
    expect(classifyIntent("hola, busco apartamento en Envigado")).toBe(Intent.SEARCH);
  });

  it("es indiferente a tildes y mayúsculas", () => {
    expect(classifyIntent("BUSCO APARTAMENTO EN MEDELLÍN")).toBe(Intent.SEARCH);
    expect(classifyIntent("quiero agendar una visita")).toBe(
      classifyIntent("QUIERO AGENDAR UNA VISITA"),
    );
  });
});

describe("decideEscalation", () => {
  it("lo que pide el cliente manda", () => {
    const decision = decideEscalation(signals({ intent: Intent.HANDOFF }));

    expect(decision).toEqual({ escalate: true, reason: HandoffReason.USER_REQUEST });
  });

  it("un tema fuera de alcance va a una persona", () => {
    expect(decideEscalation(signals({ intent: Intent.OUT_OF_SCOPE })).reason).toBe(
      HandoffReason.OUT_OF_SCOPE,
    );
  });

  it("un proveedor caído no se le explica al cliente: se escala", () => {
    expect(decideEscalation(signals({ providerFailed: true })).reason).toBe(
      HandoffReason.PROVIDER_FAILURE,
    );
  });

  it("el segundo turno fallido seguido escala, con el límite por defecto", () => {
    expect(decideEscalation(signals({ consecutiveFailedTurns: 0 })).escalate).toBe(false);
    expect(decideEscalation(signals({ consecutiveFailedTurns: 1 })).reason).toBe(
      HandoffReason.REPEATED_FAILURE,
    );
  });

  it("respeta el límite configurado por cada inmobiliaria", () => {
    const tolerant = signals({ consecutiveFailedTurns: 1, maxConsecutiveFailedTurns: 4 });

    expect(decideEscalation(tolerant).escalate).toBe(false);
  });

  it("agotar el presupuesto del turno escala en vez de dejar al cliente sin respuesta", () => {
    expect(decideEscalation(signals({ budgetExhausted: true })).reason).toBe(
      HandoffReason.BUDGET_EXHAUSTED,
    );
  });

  it("una conversación normal no escala", () => {
    expect(decideEscalation(signals())).toEqual({ escalate: false });
  });
});

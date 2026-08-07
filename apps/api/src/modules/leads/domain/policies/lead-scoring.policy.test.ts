import { describe, expect, it } from "vitest";
import { LeadBand } from "../value-objects/lead-score";
import { LeadOperation, LeadTimeline, type LeadRequirements } from "../value-objects/lead-requirements";
import { scoreLead, type LeadSignals } from "./lead-scoring.policy";

const signals = (patch: Partial<LeadSignals> = {}): LeadSignals => ({
  requirements: {},
  distinctPropertiesShown: 0,
  repeatedViews: 0,
  requestedVisit: false,
  hasName: false,
  contactMessages: 1,
  ...patch,
});

const COMPLETE: LeadRequirements = {
  operation: LeadOperation.RENT,
  city: "Medellín",
  propertyTypes: ["APARTMENT"],
  budget: { max: 2_000_000_00, currency: "COP" },
};

describe("Política de scoring — priorizar a quién llamar primero", () => {
  it("un 'hola' y nada más es un lead frío", () => {
    const score = scoreLead(signals());

    expect(score.value).toBe(0);
    expect(score.band).toBe(LeadBand.COLD);
    expect(score.reasons).toHaveLength(0);
  });

  it("pedir una visita pesa más que cualquier dato del formulario", () => {
    const dioLaCiudad = scoreLead(signals({ requirements: { city: "Medellín" } }));
    const pidioVisita = scoreLead(signals({ requestedVisit: true }));

    // Pedir ver algo predice una venta mucho mejor que rellenar campos.
    expect(pidioVisita.value).toBeGreaterThan(dioLaCiudad.value);
    expect(pidioVisita.reasons[0]?.code).toBe("requested_visit");
  });

  it("un cliente completo que vio inmuebles y quiere visitar está caliente", () => {
    const score = scoreLead(
      signals({
        requirements: { ...COMPLETE, timeline: LeadTimeline.NOW },
        distinctPropertiesShown: 4,
        requestedVisit: true,
        hasName: true,
        contactMessages: 6,
      }),
    );

    expect(score.band).toBe(LeadBand.HOT);
  });

  it("nunca pasa de 100, aunque se acumulen todas las señales", () => {
    const score = scoreLead(
      signals({
        requirements: { ...COMPLETE, timeline: LeadTimeline.NOW, financing: "mortgage" },
        distinctPropertiesShown: 40,
        repeatedViews: 20,
        requestedVisit: true,
        hasName: true,
        contactMessages: 50,
      }),
    );

    expect(score.value).toBe(100);
  });

  it("ver más inmuebles suma, pero con techo: mirar no es comprar", () => {
    const cuatro = scoreLead(signals({ distinctPropertiesShown: 4 }));
    const veinte = scoreLead(signals({ distinctPropertiesShown: 20 }));

    expect(veinte.value).toBe(cuatro.value);
  });

  it("«no sé cómo lo voy a pagar» no cuenta como forma de pago declarada", () => {
    const desconocido = scoreLead(signals({ requirements: { financing: "unknown" } }));
    const declarado = scoreLead(signals({ requirements: { financing: "cash" } }));

    expect(desconocido.value).toBe(0);
    expect(declarado.value).toBeGreaterThan(0);
  });

  it("explica el porqué, de mayor a menor peso: es lo que lee un asesor", () => {
    const score = scoreLead(
      signals({ requirements: COMPLETE, requestedVisit: true, hasName: true }),
    );

    const points = score.reasons.map((reason) => reason.points);
    expect([...points].sort((a, b) => b - a)).toEqual(points);
    expect(score.reasons.map((reason) => reason.code)).toContain("requested_visit");
  });

  it("es determinista: las mismas señales dan el mismo número", () => {
    const input = signals({ requirements: COMPLETE, distinctPropertiesShown: 2 });
    expect(scoreLead(input)).toEqual(scoreLead(input));
  });
});

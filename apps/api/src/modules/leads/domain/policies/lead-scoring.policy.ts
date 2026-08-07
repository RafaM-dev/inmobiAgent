import {
  bandFor,
  type LeadScore,
  type ScoreReason,
} from "../value-objects/lead-score";
import {
  LeadTimeline,
  type LeadFinancing,
  type LeadRequirements,
} from "../value-objects/lead-requirements";

/**
 * POLÍTICA DE SCORING (docs §5.5).
 *
 * Función pura: mismas señales, mismo número, siempre. No toca base de datos, no
 * llama a ningún proveedor y no sabe qué es un LLM — por eso se puede testear
 * exhaustivamente y por eso una inmobiliaria podrá ajustar sus pesos en F7 sin
 * que se toque una línea de infraestructura.
 *
 * Los pesos salen de cómo se cualifica de verdad en el sector: lo que más
 * predice una venta no es cuántos datos dio el cliente, sino que haya pedido
 * ver algo. Por eso "pidió agendar" pesa el doble que tener la ciudad.
 */

export interface LeadSignals {
  readonly requirements: LeadRequirements;
  /** Inmuebles DISTINTOS que se le mostraron. */
  readonly distinctPropertiesShown: number;
  /** Veces que se le mostró un inmueble ya visto: interés repetido. */
  readonly repeatedViews: number;
  /** El cliente pidió agendar una visita en algún momento. */
  readonly requestedVisit: boolean;
  readonly hasName: boolean;
  /** Mensajes escritos por el cliente. Distingue "hola" de una conversación. */
  readonly contactMessages: number;
}

/* Pesos. En un solo sitio y con nombre: cambiarlos es una decisión, no un ajuste
 * perdido dentro de una fórmula. */
const POINTS = {
  operation: 10,
  city: 10,
  propertyType: 8,
  budget: 12,
  perProperty: 5,
  maxProperties: 4,
  repeatedView: 3,
  maxRepeated: 6,
  requestedVisit: 20,
  timelineNow: 10,
  timelineSoon: 6,
  financing: 5,
  name: 5,
  engaged: 4,
} as const;

const ENGAGED_MESSAGES = 4;

export const scoreLead = (signals: LeadSignals): LeadScore => {
  const reasons: ScoreReason[] = [];
  const add = (code: string, points: number, detail: string): void => {
    if (points > 0) reasons.push({ code, points, detail });
  };

  const { requirements: req } = signals;

  /* 1. Completitud: cuánto sabemos de lo que quiere. */
  if (req.operation) add("operation", POINTS.operation, "Sabemos si compra o arrienda");
  if (req.city) add("city", POINTS.city, `Zona definida: ${req.city}`);
  if (req.propertyTypes?.length) {
    add("property_type", POINTS.propertyType, `Tipo definido: ${req.propertyTypes.join("/")}`);
  }
  if (req.budget && (req.budget.max !== undefined || req.budget.min !== undefined)) {
    add("budget", POINTS.budget, "Presupuesto declarado");
  }

  /* 2. Interés: lo que de verdad predice una visita. */
  const shown = Math.min(signals.distinctPropertiesShown, POINTS.maxProperties);
  if (shown > 0) {
    add(
      "properties_shown",
      shown * POINTS.perProperty,
      `Vio ${String(signals.distinctPropertiesShown)} inmuebles`,
    );
  }

  const repeated = Math.min(signals.repeatedViews * POINTS.repeatedView, POINTS.maxRepeated);
  if (repeated > 0) add("repeated_views", repeated, "Volvió sobre inmuebles que ya había visto");

  if (signals.requestedVisit) {
    add("requested_visit", POINTS.requestedVisit, "Pidió agendar una visita");
  }

  /* 3. Señales declaradas. */
  if (req.timeline === LeadTimeline.NOW) {
    add("timeline_now", POINTS.timelineNow, "Necesita mudarse ya");
  } else if (req.timeline === LeadTimeline.ONE_TO_THREE_MONTHS) {
    add("timeline_soon", POINTS.timelineSoon, "Plazo de uno a tres meses");
  }

  if (isDeclared(req.financing)) {
    add("financing", POINTS.financing, `Forma de pago: ${req.financing}`);
  }

  if (signals.hasName) add("has_name", POINTS.name, "Dejó su nombre");
  if (signals.contactMessages >= ENGAGED_MESSAGES) {
    add("engaged", POINTS.engaged, "Conversación sostenida");
  }

  const total = Math.min(
    100,
    reasons.reduce((sum, reason) => sum + reason.points, 0),
  );

  return {
    value: total,
    band: bandFor(total),
    // De más a menos determinante: es el orden en el que un asesor lo leería.
    reasons: [...reasons].sort((a, b) => b.points - a.points),
  };
};

/** `unknown` es "no lo sabemos", no una forma de pago. */
const isDeclared = (financing: LeadFinancing | undefined): financing is LeadFinancing =>
  financing !== undefined && financing !== "unknown";

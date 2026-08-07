/**
 * Puntuación comercial de un lead.
 *
 * Dos decisiones que la hacen útil en vez de decorativa:
 *
 * 1. **Es un número CON motivos.** Un asesor que abre la bandeja y ve "87" no
 *    aprende nada; uno que ve "87 — pidió agendar visita (+20), vio 4 inmuebles
 *    (+20), plazo inmediato (+10)" sabe por dónde empezar la llamada. Los
 *    motivos también hacen que el algoritmo sea auditable: si un día alguien
 *    discute la priorización, la respuesta está en la fila, no en el código.
 *
 * 2. **La calcula una función pura, no el modelo de IA.** Priorizar clientes es
 *    una decisión de negocio de la inmobiliaria. Dejarla a un LLM la haría no
 *    determinista, no auditable y distinta cada vez que cambie de proveedor.
 */

export const LeadBand = {
  COLD: "COLD",
  WARM: "WARM",
  HOT: "HOT",
} as const;
export type LeadBand = (typeof LeadBand)[keyof typeof LeadBand];

/** Contribución concreta al total. El `code` es estable; el texto es de UI. */
export interface ScoreReason {
  readonly code: string;
  readonly points: number;
  readonly detail: string;
}

export interface LeadScore {
  /** 0–100. */
  readonly value: number;
  readonly band: LeadBand;
  readonly reasons: readonly ScoreReason[];
}

export const WARM_THRESHOLD = 40;
export const HOT_THRESHOLD = 70;

export const bandFor = (value: number): LeadBand => {
  if (value >= HOT_THRESHOLD) return LeadBand.HOT;
  if (value >= WARM_THRESHOLD) return LeadBand.WARM;
  return LeadBand.COLD;
};

export const emptyScore = (): LeadScore => ({
  value: 0,
  band: LeadBand.COLD,
  reasons: [],
});

/** Orden comercial: HOT antes que WARM antes que COLD. */
export const BAND_RANK: Record<LeadBand, number> = {
  HOT: 2,
  WARM: 1,
  COLD: 0,
};

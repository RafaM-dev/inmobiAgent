/**
 * Traza de lo que hizo el agente en un turno.
 *
 * No es un log: es parte del producto. Sin esto, un asesor que recibe la queja
 * "el bot me dijo que costaba 300 millones" no tiene forma de saber si el dato
 * salió de una herramienta o se lo inventó el modelo. Con esto, se reconstruye
 * el turno completo — y en F8 se puede reejecutar contra fixtures grabados.
 */
export const AgentStepType = {
  /** Razonamiento o mensaje intermedio del modelo. */
  THOUGHT: "THOUGHT",
  TOOL_CALL: "TOOL_CALL",
  TOOL_RESULT: "TOOL_RESULT",
  /** Respuesta final que se le entrega al cliente. */
  MESSAGE: "MESSAGE",
  /** Un guardrail intervino: bloqueó, corrigió o forzó escalamiento. */
  GUARDRAIL: "GUARDRAIL",
} as const;
export type AgentStepType = (typeof AgentStepType)[keyof typeof AgentStepType];

export interface AgentStep {
  readonly ordinal: number;
  readonly type: AgentStepType;
  /** Nombre de la herramienta o del guardrail, cuando aplica. */
  readonly name: string | undefined;
  /** Contenido ya truncado: aquí no se guardan respuestas de 2 MB. */
  readonly payload: Record<string, unknown>;
  readonly durationMs: number;
  readonly at: Date;
  readonly error: string | undefined;
}

/** Corta valores largos antes de persistirlos, conservando el principio útil. */
export const truncate = (value: unknown, maxLength = 2000): unknown => {
  if (typeof value === "string") {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…[truncado]`;
  }
  if (value === null || typeof value !== "object") return value;

  const serialized = JSON.stringify(value);
  if (serialized.length <= maxLength) return value;
  return { truncated: true, preview: `${serialized.slice(0, maxLength)}…` };
};

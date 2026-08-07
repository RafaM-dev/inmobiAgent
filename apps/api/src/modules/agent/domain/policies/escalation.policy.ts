import { Intent } from "../value-objects/intent";

/**
 * Motivo por el que una conversación pasa a manos de una persona.
 * Se persiste y se muestra al asesor: llegar a un chat sin saber por qué te lo
 * pasaron es la forma más rápida de que el handoff no sirva de nada.
 */
export const HandoffReason = {
  USER_REQUEST: "USER_REQUEST",
  OUT_OF_SCOPE: "OUT_OF_SCOPE",
  REPEATED_FAILURE: "REPEATED_FAILURE",
  TOOL_FAILURE: "TOOL_FAILURE",
  PROVIDER_FAILURE: "PROVIDER_FAILURE",
  BUDGET_EXHAUSTED: "BUDGET_EXHAUSTED",
  GUARDRAIL: "GUARDRAIL",
  BUSINESS_RULE: "BUSINESS_RULE",
} as const;
export type HandoffReason = (typeof HandoffReason)[keyof typeof HandoffReason];

export interface EscalationSignals {
  readonly intent: Intent;
  /** Turnos seguidos que acabaron mal antes de este. */
  readonly consecutiveFailedTurns: number;
  /** Límite configurado por el tenant. */
  readonly maxConsecutiveFailedTurns: number;
  readonly providerFailed: boolean;
  readonly guardrailBlocked: boolean;
  readonly budgetExhausted: boolean;
  /** Reglas del tenant, ya evaluadas fuera (p. ej. presupuesto > X). */
  readonly businessRuleTriggered?: boolean;
}

export interface EscalationDecision {
  readonly escalate: boolean;
  readonly reason?: HandoffReason;
}

const NO_ESCALATION: EscalationDecision = { escalate: false };

/**
 * ¿Hay que pasar esta conversación a un humano? (docs §12.2)
 *
 * Función pura y sin IA de por medio. Que un cliente enfadado llegue o no a
 * una persona no puede depender de cómo se sintiera el modelo ese día: es una
 * regla de negocio, se lee en diez líneas y se prueba entera.
 *
 * El orden es el de gravedad: lo que el cliente pide explícitamente va primero,
 * porque ignorarlo es la peor experiencia posible.
 */
export const decideEscalation = (signals: EscalationSignals): EscalationDecision => {
  if (signals.intent === Intent.HANDOFF) {
    return { escalate: true, reason: HandoffReason.USER_REQUEST };
  }
  if (signals.intent === Intent.OUT_OF_SCOPE) {
    return { escalate: true, reason: HandoffReason.OUT_OF_SCOPE };
  }
  if (signals.businessRuleTriggered === true) {
    return { escalate: true, reason: HandoffReason.BUSINESS_RULE };
  }
  if (signals.providerFailed) {
    return { escalate: true, reason: HandoffReason.PROVIDER_FAILURE };
  }
  if (signals.guardrailBlocked) {
    return { escalate: true, reason: HandoffReason.GUARDRAIL };
  }
  if (signals.budgetExhausted) {
    return { escalate: true, reason: HandoffReason.BUDGET_EXHAUSTED };
  }
  // El turno actual cuenta: con el límite en 2, el segundo fallo seguido escala.
  if (signals.consecutiveFailedTurns + 1 >= signals.maxConsecutiveFailedTurns) {
    return { escalate: true, reason: HandoffReason.REPEATED_FAILURE };
  }
  return NO_ESCALATION;
};

/** Texto que ve el cliente. Nunca menciona errores técnicos. */
export const handoffMessage = (reason: HandoffReason, advisorName = "un asesor"): string => {
  switch (reason) {
    case HandoffReason.USER_REQUEST:
      return `Claro, te comunico con ${advisorName}. En un momento te escriben por aquí mismo.`;
    case HandoffReason.OUT_OF_SCOPE:
      return `Ese tema lo ve mejor ${advisorName} directamente contigo. Ya le paso la conversación.`;
    case HandoffReason.BUSINESS_RULE:
      return `Por lo que me cuentas, prefiero que te atienda ${advisorName} personalmente. Ya le aviso.`;
    default:
      return `Déjame pasarte con ${advisorName} para que te ayude mejor. En un momento te escriben.`;
  }
};

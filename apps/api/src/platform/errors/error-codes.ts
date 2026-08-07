/**
 * Códigos de error estables del sistema.
 *
 * Son parte del contrato público: el frontend y los canales ramifican sobre
 * ellos. Cambiar un código es un breaking change; añadir uno, no.
 */
export const ErrorCode = {
  // Genéricos
  INTERNAL: "INTERNAL",
  VALIDATION: "VALIDATION",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  RATE_LIMITED: "RATE_LIMITED",

  // Reglas de negocio
  DOMAIN_RULE_VIOLATION: "DOMAIN_RULE_VIOLATION",
  INVARIANT_VIOLATION: "INVARIANT_VIOLATION",

  // Dependencias externas (LLM, PropertyService, canales)
  UPSTREAM_UNAVAILABLE: "UPSTREAM_UNAVAILABLE",
  UPSTREAM_TIMEOUT: "UPSTREAM_TIMEOUT",
  UPSTREAM_INVALID_RESPONSE: "UPSTREAM_INVALID_RESPONSE",

  // Multi-tenancy
  TENANT_CONTEXT_MISSING: "TENANT_CONTEXT_MISSING",
  TENANT_MISMATCH: "TENANT_MISMATCH",

  // Agente
  AGENT_BUDGET_EXCEEDED: "AGENT_BUDGET_EXCEEDED",
  AGENT_GUARDRAIL_BLOCKED: "AGENT_GUARDRAIL_BLOCKED",
  TOOL_EXECUTION_FAILED: "TOOL_EXECUTION_FAILED",
  TOOL_INVALID_ARGUMENTS: "TOOL_INVALID_ARGUMENTS",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Guardrails: la última revisión antes de que el cliente lea nada.
 *
 * Un guardrail NO es un filtro de contenido genérico. Es una comprobación de
 * negocio: "este producto no puede decirle a un cliente un precio que nadie le
 * ha dado". Por eso viven en la capa de aplicación, junto a las reglas, y no
 * dentro del adaptador de un proveedor.
 */

export interface GuardrailInput {
  /** Texto que el modelo quiere enviar. */
  readonly draft: string;
  /**
   * Todo lo que devolvieron las herramientas en este turno, serializado.
   * Es la ÚNICA fuente de datos que el agente tiene permitido citar.
   */
  readonly toolOutputs: readonly string[];
  readonly maxLength: number;
}

export type GuardrailVerdict =
  | { readonly status: "pass" }
  /** Se corrige sin molestar a nadie (recortes, formato). */
  | { readonly status: "rewrite"; readonly text: string; readonly reason: string }
  /** No se puede enviar. Se reintenta una vez y, si insiste, se escala. */
  | { readonly status: "block"; readonly reason: string; readonly feedback: string };

export interface Guardrail {
  readonly name: string;
  check(input: GuardrailInput): GuardrailVerdict;
}

export interface GuardrailOutcome {
  readonly text: string;
  readonly blocked: boolean;
  readonly violations: readonly { name: string; reason: string }[];
  /** Instrucción para que el modelo se corrija en el reintento. */
  readonly feedback: string | undefined;
}

/**
 * Ejecuta la cadena completa. Las reescrituras se encadenan; el primer bloqueo
 * corta, porque no tiene sentido seguir puliendo un texto que no se va a enviar.
 */
export const evaluateGuardrails = (
  guardrails: readonly Guardrail[],
  input: GuardrailInput,
): GuardrailOutcome => {
  let text = input.draft;
  const violations: { name: string; reason: string }[] = [];

  for (const guardrail of guardrails) {
    const verdict = guardrail.check({ ...input, draft: text });

    if (verdict.status === "pass") continue;

    if (verdict.status === "rewrite") {
      violations.push({ name: guardrail.name, reason: verdict.reason });
      text = verdict.text;
      continue;
    }

    violations.push({ name: guardrail.name, reason: verdict.reason });
    return { text, blocked: true, violations, feedback: verdict.feedback };
  }

  return { text, blocked: false, violations, feedback: undefined };
};

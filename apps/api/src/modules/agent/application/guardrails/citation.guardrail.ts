import { NO_ANSWER_CODE } from "../tools/search-knowledge.tool";
import type { Guardrail, GuardrailInput, GuardrailVerdict } from "./guardrail";

/**
 * Respuesta que sustituye a lo que el modelo hubiera escrito sin tener fuente.
 * Es deliberadamente sosa: admite el límite y ofrece una salida.
 */
export const NO_ANSWER_REPLY =
  "Prefiero no darte un dato que no tenga confirmado. Déjame verificarlo con un asesor y " +
  "te cuento. ¿Hay algo más en lo que te pueda ayudar mientras tanto?";

interface ToolOutcome {
  ok?: unknown;
  code?: unknown;
}

const parse = (raw: string): ToolOutcome | null => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null ? value : null;
  } catch {
    return null;
  }
};

/**
 * `CitationGuardrail` — sin fuente, no hay respuesta (docs §13, principio 5).
 *
 * Cuando la base de conocimiento no encuentra nada, `search_knowledge` devuelve
 * `NO_ANSWER`. A partir de ahí, lo que el modelo redacte **no puede salir**: no
 * tiene en qué apoyarse, y una respuesta plausible sobre las condiciones de un
 * contrato es exactamente el daño que este producto no puede hacer.
 *
 * Es una REESCRITURA y no un bloqueo, y la diferencia importa. Bloquear
 * reintentaría con el modelo, y reintentar no crea información que no existe:
 * solo gasta dinero y latencia para llegar a la misma nada. Se sustituye por un
 * texto fijo y la conversación sigue.
 *
 * No se dispara si el turno consiguió datos por otra vía. Que falle la consulta
 * a la documentación no puede tumbar una respuesta que sí estaba fundada en, por
 * ejemplo, una búsqueda de inmuebles.
 */
export class CitationGuardrail implements Guardrail {
  readonly name = "citation";

  check(input: GuardrailInput): GuardrailVerdict {
    const outcomes = input.toolOutputs.map(parse);

    const noAnswer = outcomes.some(
      (outcome) => outcome?.ok === false && outcome.code === NO_ANSWER_CODE,
    );
    if (!noAnswer) return { status: "pass" };

    // ¿Hubo alguna herramienta que sí trajo datos? Entonces la respuesta puede
    // apoyarse en ella y no hay nada que corregir.
    const grounded = outcomes.some((outcome) => outcome?.ok === true);
    if (grounded) return { status: "pass" };

    if (input.draft.trim() === NO_ANSWER_REPLY) return { status: "pass" };

    return {
      status: "rewrite",
      text: NO_ANSWER_REPLY,
      reason: "La documentación no tiene respuesta y no hay ninguna otra fuente en el turno",
    };
  }
}

import type { ReplyBlock } from "../src/modules/channels";
import type { Harness } from "../src/modules/agent/testing/agent-turn.harness";

/**
 * EVALUACIÓN DE CALIDAD: los tipos.
 *
 * El problema que resuelve esto es el que ha mordido dos veces en este proyecto
 * y muerde siempre en los productos de IA: **los fallos que no rompen nada**.
 * Un cambio de prompt, una versión nueva de un modelo o una herramienta
 * retocada pueden empeorar las respuestas sin que falle un solo test, porque
 * los tests comprueban que el código hace lo que se le pidió, no que el agente
 * conteste bien.
 *
 * La disciplina de esta suite:
 *
 * 1. **El juez es determinista.** Nada de "que otro modelo puntúe la
 *    respuesta": eso exige una API key —lo que el producto se niega a
 *    requerir—, cuesta dinero por ejecución y da un número distinto cada vez.
 *    Aquí todas las comprobaciones son código: expresiones regulares,
 *    herramientas invocadas, estado del CRM y de la agenda.
 * 2. **Dos clases de expectativa, no una nota media.** Un fallo `critical` es un
 *    defecto de producto —inventar un precio, escribir una fecha— y hace fallar
 *    la ejecución entera por muy alta que sea la puntuación. Los de `quality`
 *    son la nota. Mezclarlos permitiría compensar un precio inventado con diez
 *    respuestas simpáticas.
 * 3. **La misma suite contra el simulador y contra un modelo real.** Con el
 *    simulador mide el ARNÉS: prompts, herramientas, políticas, guardrails y
 *    composición, que es la mayor parte del producto. Con un proveedor real
 *    mide además el criterio del modelo. Conviene no confundirlos, y por eso el
 *    informe dice siempre contra qué se ha corrido.
 */

export type Severity = "critical" | "quality";

/** Lo que ve una comprobación después de un turno. */
export interface EvalContext {
  /** Texto que recibiría el cliente, con todos los bloques proyectados. */
  readonly reply: string;
  /** Solo lo que REDACTÓ el modelo, sin las fichas ni los botones. */
  readonly spoken: string;
  readonly blocks: readonly ReplyBlock[];
  readonly toolsUsed: readonly string[];
  /** Todo lo que devolvieron las herramientas de este turno, serializado. */
  readonly toolOutput: string;
  readonly status: "COMPLETED" | "ESCALATED" | "SKIPPED";
  readonly latencyMs: number;
  readonly costUsd: number;
  /** Estado del mundo: CRM, agenda, perfil del contacto. */
  readonly harness: Harness;
}

export interface Expectation {
  readonly name: string;
  readonly severity: Severity;
  /** `null` si pasa; si no, la razón concreta del fallo. */
  check(context: EvalContext): string | null;
}

export interface EvalTurn {
  /** Lo que escribe el cliente. */
  readonly user: string;
  readonly expect: readonly Expectation[];
}

export interface EvalScenario {
  readonly id: string;
  readonly title: string;
  /**
   * Qué se rompería en el producto si este escenario empezara a fallar.
   *
   * Obligatorio, y no es burocracia: un escenario cuyo motivo no se sabe
   * escribir es un escenario que nadie sabrá arreglar cuando falle dentro de un
   * año, y que acabará marcado como `skip`.
   */
  readonly why: string;
  readonly tags: readonly string[];
  readonly turns: readonly EvalTurn[];
  /** Comprobaciones sobre el estado final de la conversación. */
  readonly then?: readonly Expectation[];
}

export const scenario = (definition: EvalScenario): EvalScenario => definition;

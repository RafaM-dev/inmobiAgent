import { describe, expect, it } from "vitest";
import { judge, readBaseline, formatScenario } from "./report";
import { runEvaluation } from "./runner";
import { allScenarios } from "./scenarios";

/**
 * La evaluación de calidad, dentro de `pnpm test`.
 *
 * **Una suite de evaluación que no corre en cada cambio no existe.** Si vive
 * solo en un comando manual, se ejecuta la semana que se escribe y nunca más, y
 * su valor entero —avisar de una regresión ANTES de subirla— se pierde.
 *
 * Corre contra el simulador determinista: sin claves, sin coste y sin ruido. Lo
 * que mide en ese modo es el ARNÉS —prompts, herramientas, políticas,
 * guardrails, composición, memoria—, que es la mayor parte del producto. El
 * criterio del modelo se mide con `pnpm eval --provider anthropic`, que corre
 * exactamente los mismos escenarios.
 */
describe("Evaluación de calidad del agente (simulador)", () => {
  it("no hay regresión frente a la línea base", async () => {
    const run = await runEvaluation({ scenarios: allScenarios });
    const verdict = judge(run, readBaseline());

    if (!verdict.ok) {
      // El informe completo en el mensaje de fallo: quien lo lea tiene delante
      // la transcripción y la razón concreta, sin volver a ejecutar nada.
      const detalle = run.scenarios
        .filter((scenario) => !scenario.passed)
        .map(formatScenario)
        .join("\n");
      throw new Error(`${verdict.reasons.join("; ")}\n\n${detalle}`);
    }

    expect(verdict.ok).toBe(true);
  });

  it("ningún escenario revienta el turno", async () => {
    const run = await runEvaluation({ scenarios: allScenarios });
    const reventados = run.scenarios.filter((scenario) => scenario.crashed);

    /*
     * Que un mensaje concreto haga lanzar una excepción al agente no es una
     * respuesta de baja calidad: es un cliente que se queda sin respuesta y una
     * traza en el log. Se comprueba aparte porque su arreglo es otro.
     */
    expect(reventados.map((scenario) => `${scenario.id}: ${scenario.crashed ?? ""}`)).toEqual([]);
  });

  it("cada escenario declara por qué existe", () => {
    /*
     * Un escenario sin motivo escrito es uno que nadie sabrá arreglar cuando
     * falle dentro de un año, y que acabará marcado como `skip`. Es la forma en
     * que mueren las suites de evaluación.
     */
    const sinMotivo = allScenarios.filter((definition) => definition.why.trim().length < 30);
    expect(sinMotivo.map((definition) => definition.id)).toEqual([]);
  });

  it("los identificadores son únicos", () => {
    const ids = allScenarios.map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

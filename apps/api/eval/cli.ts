import { buildContainer } from "../src/bootstrap/container";
import { loadConfig, type LlmProviderKind } from "../src/platform/config/env";
import { agentModule } from "../src/modules/agent";
import type { LLMProvider } from "../src/modules/agent/application/ports/llm-provider";
import { formatRun, judge, readBaseline, writeBaseline } from "./report";
import { runEvaluation } from "./runner";
import { allScenarios, scenariosTagged } from "./scenarios";

/**
 * `pnpm eval` — la misma suite, contra el proveedor que se le diga.
 *
 * Es el equivalente de la suite de contrato de F8: los mismos escenarios que
 * corren con el simulador en cada `pnpm test`, ejecutados contra Anthropic,
 * OpenAI u Ollama. Responde la pregunta que el simulador no puede responder —
 * *¿el modelo de verdad hace lo correcto?*— y la que se hace antes de cambiar
 * de proveedor: *¿este otro es igual de bueno, y a qué precio?*
 *
 *   pnpm eval                          # simulador: rápido, gratis, determinista
 *   pnpm eval --provider anthropic     # modelo real, cuesta dinero
 *   pnpm eval --tag seguridad          # solo un área
 *   pnpm eval --update-baseline        # fija la referencia actual
 *
 * **El proveedor se construye con el composition root real**, no a mano: así
 * corre con el mismo modelo, el mismo esfuerzo, los mismos tiempos de espera y
 * el mismo decorador de métricas que en producción. Montarlo aparte mediría una
 * configuración que nadie despliega.
 */

interface Options {
  readonly provider: LlmProviderKind | undefined;
  readonly tag: string | undefined;
  readonly updateBaseline: boolean;
}

const parseArgs = (argv: readonly string[]): Options => {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const provider = value("--provider");
  return {
    provider: provider as LlmProviderKind | undefined,
    tag: value("--tag"),
    updateBaseline: argv.includes("--update-baseline"),
  };
};

/**
 * Construye el proveedor real pasando por el contenedor.
 *
 * Se sobrescribe `LLM_PROVIDER` en el entorno antes de cargar la configuración,
 * de modo que el `switch` del módulo `agent` —el único sitio del sistema donde
 * se elige proveedor— haga exactamente lo que haría al arrancar el servidor.
 */
const buildProvider = (kind: LlmProviderKind): LLMProvider => {
  const config = loadConfig({ ...process.env, LLM_PROVIDER: kind, LOG_LEVEL: "error" });
  const container = buildContainer(config);
  agentModule.registerDependencies(container);
  return container.cradle.llmProvider;
};

const run = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  const scenarios = options.tag ? scenariosTagged(options.tag) : allScenarios;

  if (scenarios.length === 0) {
    console.error(`No hay escenarios con la etiqueta "${options.tag ?? ""}".`);
    process.exit(1);
  }

  let provider: LLMProvider | undefined;
  if (options.provider && options.provider !== "mock") {
    try {
      provider = buildProvider(options.provider);
    } catch (error) {
      // Falta la clave. No es un fallo de la suite: es que no se puede correr.
      console.error(`No se puede evaluar con "${options.provider}".`);
      console.error(`  ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  console.log(
    `Evaluando ${String(scenarios.length)} escenarios contra ${provider?.id ?? "mock"}…`,
  );
  if (provider) {
    console.log("  Ojo: esto llama a un modelo real y cuesta dinero.\n");
  }

  const evaluation = await runEvaluation({
    scenarios,
    ...(provider ? { provider } : {}),
    onProgress: (result) => {
      process.stdout.write(result.passed ? "." : "✖");
    },
  });
  console.log("");

  if (options.updateBaseline) {
    const baseline = writeBaseline(evaluation);
    console.log(
      `\n✔ Línea base actualizada: ${evaluation.provider} = ${(
        (baseline.scores[evaluation.provider] ?? 0) * 100
      ).toFixed(1)} %\n`,
    );
    return;
  }

  const verdict = judge(evaluation, readBaseline());
  console.log(formatRun(evaluation, verdict));

  if (!verdict.ok) process.exitCode = 1;
};

run().catch((error: unknown) => {
  console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

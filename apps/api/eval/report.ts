import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EvalRun, ScenarioResult } from "./runner";

/**
 * Informe y línea base.
 *
 * **La línea base es lo que convierte un informe en una suite de regresión.**
 * Un número suelto —«87 %»— no dice nada: nadie sabe si eso está bien. Comparado
 * con lo que se obtuvo ayer, dice exactamente lo que hace falta saber: si el
 * cambio que estás a punto de subir empeora el agente.
 *
 * Contra el simulador la puntuación es determinista, así que la comparación es
 * exacta y cualquier bajada es una regresión de verdad. Contra un modelo real
 * hay ruido, y por eso la comparación admite una tolerancia.
 */

const here = dirname(fileURLToPath(import.meta.url));

export interface Baseline {
  /** Puntuación de referencia por proveedor. */
  readonly scores: Record<string, number>;
  /**
   * Margen tolerado a la baja frente a la referencia.
   *
   * Con el simulador debería ser cero: si baja, alguien rompió algo. Con un
   * modelo real, dos puntos absorben su variabilidad sin tapar una regresión.
   */
  readonly tolerance: Record<string, number>;
  readonly updatedAt: string;
}

const BASELINE_PATH = join(here, "baseline.json");

export const readBaseline = (): Baseline => {
  if (!existsSync(BASELINE_PATH)) {
    return { scores: {}, tolerance: {}, updatedAt: "(nunca)" };
  }
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
};

export const writeBaseline = (run: EvalRun): Baseline => {
  const previous = readBaseline();
  const updated: Baseline = {
    scores: { ...previous.scores, [run.provider]: Number(run.score.toFixed(4)) },
    tolerance: { mock: 0, ...previous.tolerance },
    updatedAt: new Date().toISOString(),
  };

  writeFileSync(BASELINE_PATH, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  return updated;
};

export interface Verdict {
  readonly ok: boolean;
  readonly baseline: number | null;
  readonly tolerance: number;
  readonly reasons: readonly string[];
}

export const judge = (run: EvalRun, baseline: Baseline): Verdict => {
  const reference = baseline.scores[run.provider] ?? null;
  const tolerance = baseline.tolerance[run.provider] ?? 0.02;
  const reasons: string[] = [];

  /*
   * Un fallo crítico invalida la ejecución por muy alta que sea la puntuación.
   * Es la razón de que no haya una sola nota: si inventar un precio pudiera
   * compensarse con diez respuestas correctas, la suite estaría midiendo la
   * simpatía del agente en vez de si se puede confiar en él.
   */
  if (run.criticalFailures > 0) {
    reasons.push(
      `${String(run.criticalFailures)} fallo(s) crítico(s): son defectos de producto, no de estilo`,
    );
  }

  if (reference !== null && run.score < reference - tolerance) {
    reasons.push(
      `la puntuación bajó de ${percent(reference)} a ${percent(run.score)} ` +
        `(tolerancia ${percent(tolerance)})`,
    );
  }

  return { ok: reasons.length === 0, baseline: reference, tolerance, reasons };
};

const percent = (value: number): string => `${(value * 100).toFixed(1)} %`;

/* -------------------------------------------------------------------------- *
 * Formato para leer en una terminal
 * -------------------------------------------------------------------------- */

const byTag = (run: EvalRun): Map<string, { pass: number; total: number }> => {
  const tags = new Map<string, { pass: number; total: number }>();

  for (const scenario of run.scenarios) {
    for (const tag of scenario.tags) {
      const entry = tags.get(tag) ?? { pass: 0, total: 0 };
      entry.total += 1;
      if (scenario.passed) entry.pass += 1;
      tags.set(tag, entry);
    }
  }

  return tags;
};

export const formatScenario = (scenario: ScenarioResult): string => {
  const lines: string[] = [];
  const mark = scenario.passed ? "✔" : "✖";
  lines.push(`  ${mark} ${scenario.id}  ${scenario.title}`);

  if (scenario.crashed) {
    lines.push(`      ✖ REVENTÓ: ${scenario.crashed}`);
  }

  for (const result of scenario.results) {
    if (result.failure === null) continue;
    const etiqueta = result.severity === "critical" ? "CRÍTICO" : "calidad";
    const donde = result.turn >= 0 ? `turno ${String(result.turn + 1)}` : "final";
    lines.push(`      ✖ [${etiqueta}] ${result.name} (${donde})`);
    lines.push(`        ${result.failure}`);
  }

  // La transcripción solo cuando algo falla: es lo primero que se quiere leer, y
  // en verde solo sería ruido.
  if (!scenario.passed) {
    for (const turn of scenario.transcript) {
      lines.push(`        · cliente: ${turn.user.slice(0, 100)}`);
      lines.push(`          agente:  ${turn.agent.slice(0, 200)}`);
    }
  }

  return lines.join("\n");
};

export const formatRun = (run: EvalRun, verdict: Verdict): string => {
  const lines: string[] = [];
  const fallos = run.scenarios.filter((scenario) => !scenario.passed);

  lines.push("");
  for (const scenario of fallos) lines.push(formatScenario(scenario));
  if (fallos.length > 0) lines.push("");

  lines.push(`  Proveedor        ${run.provider}`);
  lines.push(
    `  Escenarios       ${String(run.scenarios.length - fallos.length)}/${String(run.scenarios.length)}`,
  );
  lines.push(
    `  Calidad          ${percent(run.score)}` +
      (verdict.baseline === null
        ? "  (sin línea base todavía)"
        : `  (referencia ${percent(verdict.baseline)})`),
  );
  lines.push(`  Fallos críticos  ${String(run.criticalFailures)}`);

  const tags = [...byTag(run)].sort(([a], [b]) => a.localeCompare(b));
  lines.push("");
  lines.push("  Por área:");
  for (const [tag, { pass, total }] of tags) {
    const barra = "█".repeat(pass) + "░".repeat(total - pass);
    lines.push(`    ${tag.padEnd(16)} ${barra} ${String(pass)}/${String(total)}`);
  }

  lines.push("");
  lines.push(
    `  ${String(run.durationMs)} ms · ${
      run.totalCostUsd === 0 ? "coste 0 USD (modo demo)" : `${run.totalCostUsd.toFixed(4)} USD`
    }`,
  );

  lines.push("");
  if (verdict.ok) {
    lines.push("✔ El agente mantiene su calidad.");
  } else {
    for (const reason of verdict.reasons) lines.push(`✖ ${reason}`);
  }

  return lines.join("\n");
};

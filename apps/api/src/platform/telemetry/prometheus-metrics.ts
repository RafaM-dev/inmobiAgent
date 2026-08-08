import type { Logger } from "../logging/logger";
import {
  LATENCY_BUCKETS,
  type Counter,
  type Gauge,
  type Histogram,
  type HistogramSpec,
  type Labels,
  type Metrics,
  type MetricSpec,
} from "./metrics";

/**
 * Registro de métricas en proceso, servido en formato de exposición Prometheus.
 *
 * **Decisión (D63): un registro propio, sin librería.** El formato de
 * exposición son treinta líneas de texto bien especificado, y escribirlas evita
 * arrastrar una dependencia con su propio registro global, su propio ciclo de
 * vida y sus propias sorpresas al testear. Lo que sí importa —el puerto— ya
 * está diseñado para que un exportador OTLP entre detrás sin tocar nada.
 *
 * **Decisión (D64): las etiquetas NUNCA llevan identificadores.** Ni
 * `tenantId`, ni `conversationId`, ni `contactId`, ni `correlationId`. Cada
 * combinación distinta de etiquetas es una serie temporal que el sistema de
 * monitorización guarda para siempre: con cientos de inmobiliarias y varias
 * métricas, etiquetar por tenant convierte un panel en una factura. El detalle
 * por inmobiliaria vive donde debe —en la base (`tenant_usage_periods`) y en
 * los logs, que sí llevan `tenantId`—. Las métricas responden "cuánto y cómo de
 * rápido"; los logs responden "a quién".
 */

/** Prefijo común. Permite `agentinmobi_*` en una consulta y verlo todo. */
const PREFIX = "agentinmobi";

/**
 * Series distintas que se toleran por métrica.
 *
 * No está para ahorrar memoria: está para que una etiqueta mal elegida —una que
 * lleve un identificador sin querer— se note como un aviso en el log en vez de
 * como una fuga que crece toda la noche.
 */
const MAX_SERIES_PER_METRIC = 2_000;

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Escapado del formato de exposición: solo estos tres caracteres. */
const escapeLabelValue = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');

/** Prometheus exige `+Inf` y `-Inf` literales; `NaN` es válido. */
const formatNumber = (value: number): string => {
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "+Inf";
  if (value === Number.NEGATIVE_INFINITY) return "-Inf";
  return String(value);
};

interface Series {
  readonly labels: Labels;
  value: number;
  /** Solo histogramas: cuentas acumuladas por cubo, y la suma. */
  buckets?: number[];
  sum?: number;
}

type MetricKind = "counter" | "gauge" | "histogram";

class Metric {
  readonly series = new Map<string, Series>();
  private overflowed = false;

  constructor(
    readonly kind: MetricKind,
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[],
    readonly buckets: readonly number[],
    private readonly onOverflow: (name: string) => void,
  ) {}

  /**
   * Serie correspondiente a unas etiquetas, creándola si hace falta.
   *
   * Las etiquetas se normalizan al orden declarado: `{a,b}` y `{b,a}` son la
   * misma serie, y una etiqueta ausente vale cadena vacía. Sin esa
   * normalización, el mismo contador incrementado desde dos sitios que pasan
   * las etiquetas en distinto orden produciría dos series que nadie suma.
   */
  seriesFor(labels: Labels | undefined): Series | null {
    const values = this.labelNames.map((name) => labels?.[name] ?? "");
    const key = JSON.stringify(values);

    const existing = this.series.get(key);
    if (existing) return existing;

    if (this.series.size >= MAX_SERIES_PER_METRIC) {
      if (!this.overflowed) {
        this.overflowed = true;
        this.onOverflow(this.name);
      }
      return null;
    }

    const normalized: Record<string, string> = {};
    this.labelNames.forEach((name, index) => {
      normalized[name] = values[index] ?? "";
    });

    const series: Series =
      this.kind === "histogram"
        ? { labels: normalized, value: 0, buckets: this.buckets.map(() => 0), sum: 0 }
        : { labels: normalized, value: 0 };

    this.series.set(key, series);
    return series;
  }
}

export class PrometheusMetrics implements Metrics {
  private readonly metrics = new Map<string, Metric>();
  private readonly collectors: (() => void)[] = [];

  constructor(private readonly deps: { logger: Logger }) {}

  counter(spec: MetricSpec): Counter {
    const metric = this.register("counter", spec, []);
    return {
      inc: (labels, value = 1) => {
        // Un contador que baja rompe `rate()` sin avisar: el sistema de
        // monitorización lo interpreta como un reinicio del proceso.
        if (value < 0) return;
        const series = metric.seriesFor(labels);
        if (series) series.value += value;
      },
    };
  }

  gauge(spec: MetricSpec): Gauge {
    const metric = this.register("gauge", spec, []);
    return {
      set: (value, labels) => {
        const series = metric.seriesFor(labels);
        if (series) series.value = value;
      },
    };
  }

  histogram(spec: HistogramSpec): Histogram {
    const buckets = [...(spec.buckets ?? LATENCY_BUCKETS)].sort((a, b) => a - b);
    const metric = this.register("histogram", spec, buckets);

    return {
      observe: (value, labels) => {
        const series = metric.seriesFor(labels);
        if (!series?.buckets) return;

        series.value += 1;
        series.sum = (series.sum ?? 0) + value;
        // Acumulados: cada cubo cuenta todo lo que cabe en él y en los menores.
        for (let i = 0; i < buckets.length; i += 1) {
          if (value <= (buckets[i] ?? 0)) series.buckets[i] = (series.buckets[i] ?? 0) + 1;
        }
      },
    };
  }

  /**
   * Registra un valor que se calcula EN EL MOMENTO de exponer, no al cambiar.
   *
   * Para lo que ya vive en otro sitio y sería absurdo duplicar: el uso de
   * memoria, el tiempo en marcha, el tamaño de una caché. Empujar esos valores
   * con un temporizador daría lo mismo a cambio de otro temporizador que
   * mantener y apagar.
   */
  onCollect(fn: () => void): void {
    this.collectors.push(fn);
  }

  /** Formato de exposición de Prometheus. Es lo que devuelve `GET /metrics`. */
  render(): string {
    for (const collect of this.collectors) {
      try {
        collect();
      } catch (error) {
        // Exponer métricas no puede fallar por culpa de una de ellas.
        this.deps.logger.warn("Un colector de métricas falló", {
          err: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const lines: string[] = [];

    for (const metric of this.metrics.values()) {
      const full = `${PREFIX}_${metric.name}`;
      lines.push(`# HELP ${full} ${metric.help.replace(/\n/g, " ")}`);
      lines.push(`# TYPE ${full} ${metric.kind}`);

      for (const series of metric.series.values()) {
        if (metric.kind !== "histogram") {
          lines.push(`${full}${renderLabels(series.labels)} ${formatNumber(series.value)}`);
          continue;
        }

        metric.buckets.forEach((bound, index) => {
          const labels = { ...series.labels, le: formatNumber(bound) };
          lines.push(
            `${full}_bucket${renderLabels(labels)} ${formatNumber(series.buckets?.[index] ?? 0)}`,
          );
        });
        // El cubo `+Inf` es obligatorio y su cuenta es el total.
        lines.push(
          `${full}_bucket${renderLabels({ ...series.labels, le: "+Inf" })} ${formatNumber(series.value)}`,
        );
        lines.push(`${full}_sum${renderLabels(series.labels)} ${formatNumber(series.sum ?? 0)}`);
        lines.push(`${full}_count${renderLabels(series.labels)} ${formatNumber(series.value)}`);
      }
    }

    // El formato exige salto de línea final; sin él, algunos analizadores
    // descartan la última muestra en silencio.
    return `${lines.join("\n")}\n`;
  }

  /**
   * Alta idempotente.
   *
   * Pedir dos veces el mismo instrumento devuelve el mismo: los módulos declaran
   * lo que miden sin coordinarse entre ellos, y el composition root no tiene que
   * llevar un inventario. Pedir el mismo nombre con OTRA forma sí es un bug, y
   * se dice en voz alta.
   */
  private register(kind: MetricKind, spec: MetricSpec, buckets: readonly number[]): Metric {
    if (!NAME_PATTERN.test(spec.name)) {
      throw new Error(
        `Nombre de métrica inválido: "${spec.name}". Debe ser snake_case sin el prefijo.`,
      );
    }

    const existing = this.metrics.get(spec.name);
    if (existing) {
      if (existing.kind !== kind) {
        throw new Error(
          `La métrica "${spec.name}" ya existe como ${existing.kind}, no como ${kind}.`,
        );
      }
      return existing;
    }

    const metric = new Metric(
      kind,
      spec.name,
      spec.help,
      spec.labelNames ?? [],
      buckets,
      (name) => {
        this.deps.logger.warn("Métrica con demasiadas series: se dejan de crear nuevas", {
          metric: name,
          limit: MAX_SERIES_PER_METRIC,
          detalle:
            "Casi siempre significa que una etiqueta lleva un identificador. " +
            "Las métricas no se etiquetan por inmobiliaria ni por conversación.",
        });
      },
    );

    this.metrics.set(spec.name, metric);
    return metric;
  }
}

const renderLabels = (labels: Labels): string => {
  const pairs = Object.entries(labels)
    .filter(([, value]) => value !== "")
    .map(([name, value]) => `${name}="${escapeLabelValue(value)}"`);

  return pairs.length === 0 ? "" : `{${pairs.join(",")}}`;
};

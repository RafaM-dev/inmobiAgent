/**
 * PUERTO `Metrics` — lo que se mide del sistema en marcha.
 *
 * Deliberadamente pequeño: tres tipos de instrumento y nada más. Todo lo que
 * hace falta para responder las cuatro preguntas que se hacen a las tres de la
 * mañana —cuánto tráfico entra, cuánto tarda, cuánto falla, cuánto se
 * acumula— cabe en un contador, un histograma y un medidor.
 *
 * **Por qué un puerto y no la librería directamente.** Es el mismo argumento
 * que con `LLMProvider` y `FileStorage`: el día que esto exporte por OTLP a un
 * colector, el cambio es un adaptador nuevo en el composition root. Ningún caso
 * de uso, ninguna política y ninguna herramienta se enteran. Hoy detrás hay un
 * registro en proceso que se sirve en formato Prometheus; mañana puede haber
 * dos a la vez.
 *
 * **Las etiquetas se declaran por adelantado.** Es la convención de Prometheus
 * y evita el fallo que arruina un panel: series de la misma métrica con
 * conjuntos de etiquetas distintos, que hacen que las consultas dejen de sumar.
 */

export type Labels = Readonly<Record<string, string>>;

export interface MetricSpec {
  /** Sin prefijo: lo pone el registro. En `snake_case`. */
  readonly name: string;
  /** Qué mide, en una frase. Sale en el `# HELP` y lo lee quien está de guardia. */
  readonly help: string;
  /** Etiquetas permitidas. Ver la nota sobre cardinalidad más abajo. */
  readonly labelNames?: readonly string[];
}

export interface HistogramSpec extends MetricSpec {
  /** Límites superiores en la unidad del histograma. Ordenados. */
  readonly buckets?: readonly number[];
}

export interface Counter {
  /** Suma. `value` por defecto 1; nunca negativo — para eso está el medidor. */
  inc(labels?: Labels, value?: number): void;
}

export interface Histogram {
  /** Anota una observación. Por convención de Prometheus, en SEGUNDOS. */
  observe(value: number, labels?: Labels): void;
}

export interface Gauge {
  set(value: number, labels?: Labels): void;
}

export interface Metrics {
  counter(spec: MetricSpec): Counter;
  histogram(spec: HistogramSpec): Histogram;
  gauge(spec: MetricSpec): Gauge;
}

/**
 * Cubos por defecto para latencias, en segundos.
 *
 * Van de un milisegundo a diez segundos porque ese es el rango real de este
 * producto: una sonda de salud responde en microsegundos y un turno con
 * herramientas y modelo se va a varios segundos. Cubos mal elegidos no dan un
 * error, dan un percentil 95 que miente.
 */
export const LATENCY_BUCKETS: readonly number[] = [
  0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

/** Métricas que no miden nada. Para los tests y para el modo sin observabilidad. */
export class NoopMetrics implements Metrics {
  private static readonly counter: Counter = { inc: () => undefined };
  private static readonly histogram: Histogram = { observe: () => undefined };
  private static readonly gauge: Gauge = { set: () => undefined };

  counter(): Counter {
    return NoopMetrics.counter;
  }
  histogram(): Histogram {
    return NoopMetrics.histogram;
  }
  gauge(): Gauge {
    return NoopMetrics.gauge;
  }
}

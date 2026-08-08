import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryLogger, NoopLogger } from "../logging/logger";
import { PrometheusMetrics } from "./prometheus-metrics";

/**
 * El formato de exposición de Prometheus es texto, y ahí está el peligro: casi
 * todos los errores posibles producen algo que PARECE correcto y que el
 * recolector descarta en silencio. Un `# TYPE` que no cuadra, un cubo `+Inf`
 * que falta, unas comillas sin escapar. No hay excepción, no hay error: hay una
 * gráfica vacía el día que hace falta.
 */

describe("Registro de métricas en formato Prometheus", () => {
  let metrics: PrometheusMetrics;

  beforeEach(() => {
    metrics = new PrometheusMetrics({ logger: new NoopLogger() });
  });

  const lines = (): string[] => metrics.render().trimEnd().split("\n");

  it("expone un contador con su ayuda, su tipo y su valor", () => {
    const requests = metrics.counter({
      name: "http_requests_total",
      help: "Peticiones atendidas.",
      labelNames: ["method"],
    });

    requests.inc({ method: "GET" });
    requests.inc({ method: "GET" });
    requests.inc({ method: "POST" }, 3);

    expect(lines()).toEqual([
      "# HELP agentinmobi_http_requests_total Peticiones atendidas.",
      "# TYPE agentinmobi_http_requests_total counter",
      'agentinmobi_http_requests_total{method="GET"} 2',
      'agentinmobi_http_requests_total{method="POST"} 3',
    ]);
  });

  it("el orden de las etiquetas no crea series distintas", () => {
    const counter = metrics.counter({
      name: "tool_calls_total",
      help: "Llamadas.",
      labelNames: ["tool", "outcome"],
    });

    counter.inc({ tool: "buscar", outcome: "ok" });
    counter.inc({ outcome: "ok", tool: "buscar" });

    /*
     * Dos sitios distintos incrementan el mismo contador pasando las etiquetas
     * en otro orden. Sin normalizar saldrían dos series con el mismo aspecto y
     * la mitad del valor cada una, y ninguna consulta las sumaría.
     */
    expect(lines()).toContain('agentinmobi_tool_calls_total{tool="buscar",outcome="ok"} 2');
    expect(lines().filter((line) => line.startsWith("agentinmobi_tool_calls_total{"))).toHaveLength(
      1,
    );
  });

  it("un histograma acumula los cubos e incluye el +Inf obligatorio", () => {
    const duration = metrics.histogram({
      name: "request_duration_seconds",
      help: "Latencia.",
      buckets: [0.1, 1],
    });

    duration.observe(0.05);
    duration.observe(0.5);
    duration.observe(5);

    const rendered = lines();

    // Los cubos son ACUMULADOS: `le="1"` cuenta también lo que cabía en `le="0.1"`.
    expect(rendered).toContain('agentinmobi_request_duration_seconds_bucket{le="0.1"} 1');
    expect(rendered).toContain('agentinmobi_request_duration_seconds_bucket{le="1"} 2');
    // Sin `+Inf` el histograma es inválido y el recolector lo descarta entero.
    expect(rendered).toContain('agentinmobi_request_duration_seconds_bucket{le="+Inf"} 3');
    expect(rendered).toContain("agentinmobi_request_duration_seconds_sum 5.55");
    expect(rendered).toContain("agentinmobi_request_duration_seconds_count 3");
  });

  it("el límite de un cubo incluye su propio valor", () => {
    const duration = metrics.histogram({
      name: "d_seconds",
      help: "Latencia.",
      buckets: [0.1],
    });

    // `le` significa "menor o igual". Con `<` estricto, una latencia que cae
    // justo en el límite se contaría en el cubo siguiente y los percentiles
    // saldrían sistemáticamente altos.
    duration.observe(0.1);

    expect(lines()).toContain('agentinmobi_d_seconds_bucket{le="0.1"} 1');
  });

  it("ordena los cubos aunque se declaren desordenados", () => {
    const duration = metrics.histogram({
      name: "d_seconds",
      help: "Latencia.",
      buckets: [1, 0.1, 0.5],
    });
    duration.observe(0.3);

    const buckets = lines().filter((line) => line.includes("_bucket{"));
    // Prometheus exige los cubos en orden creciente.
    expect(buckets[0]).toContain('le="0.1"');
    expect(buckets[1]).toContain('le="0.5"');
    expect(buckets[2]).toContain('le="1"');
  });

  it("escapa lo que rompería el formato", () => {
    const counter = metrics.counter({
      name: "errors_total",
      help: "Errores.",
      labelNames: ["detail"],
    });

    counter.inc({ detail: 'dijo "hola"\ny se fue\\' });

    // Sin escapar, las comillas cierran el valor antes de tiempo y el
    // recolector descarta la muestra sin decir nada.
    expect(lines()).toContain(
      'agentinmobi_errors_total{detail="dijo \\"hola\\"\\ny se fue\\\\"} 1',
    );
  });

  it("una etiqueta vacía se omite, como manda el formato", () => {
    const counter = metrics.counter({
      name: "events_total",
      help: "Eventos.",
      labelNames: ["kind"],
    });

    counter.inc();

    expect(lines()).toContain("agentinmobi_events_total 1");
  });

  it("un contador nunca baja", () => {
    const counter = metrics.counter({ name: "c_total", help: "Cosas." });

    counter.inc(undefined, 5);
    counter.inc(undefined, -3);

    /*
     * `rate()` interpreta cualquier bajada de un contador como un reinicio del
     * proceso y descarta el tramo. Un decremento no daría un número menor: daría
     * un pico falso en la gráfica.
     */
    expect(lines()).toContain("agentinmobi_c_total 5");
  });

  it("un medidor sí puede bajar", () => {
    const gauge = metrics.gauge({ name: "queue_depth", help: "Pendientes." });

    gauge.set(10);
    gauge.set(4);

    expect(lines()).toContain("agentinmobi_queue_depth 4");
  });

  it("pedir dos veces el mismo instrumento devuelve el mismo", () => {
    const a = metrics.counter({ name: "shared_total", help: "Compartido." });
    const b = metrics.counter({ name: "shared_total", help: "Compartido." });

    a.inc();
    b.inc();

    // Dos módulos declaran lo que miden sin coordinarse. Si esto crease dos
    // registros, uno de los dos contaría al vacío.
    expect(lines()).toContain("agentinmobi_shared_total 2");
  });

  it("reusar un nombre con otra forma es un bug y se dice en voz alta", () => {
    metrics.counter({ name: "duplicado", help: "Un contador." });

    expect(() => metrics.gauge({ name: "duplicado", help: "Ahora un medidor." })).toThrow(
      /ya existe como counter/,
    );
  });

  it("rechaza nombres que el formato no admite", () => {
    expect(() => metrics.counter({ name: "Con Mayúsculas", help: "No." })).toThrow(/inválido/);
  });

  it("corta la cardinalidad y avisa de por qué", () => {
    const logger = new InMemoryLogger();
    const limited = new PrometheusMetrics({ logger });
    const counter = limited.counter({
      name: "fuga_total",
      help: "Con una etiqueta mal elegida.",
      labelNames: ["conversation_id"],
    });

    // El fallo clásico: una etiqueta que lleva un identificador. Cada valor
    // nuevo es una serie que el sistema de monitorización guarda para siempre.
    for (let i = 0; i < 2_500; i += 1) counter.inc({ conversation_id: `c${String(i)}` });

    const series = limited.render().split("\n").filter((line) => line.startsWith("agentinmobi_"));
    expect(series.length).toBe(2_000);

    const aviso = logger.entries.find((entry) => entry.message.includes("demasiadas series"));
    expect(aviso).toBeDefined();
  });

  it("un colector que revienta no tumba la exposición entera", () => {
    const logger = new InMemoryLogger();
    const resistente = new PrometheusMetrics({ logger });
    const gauge = resistente.gauge({ name: "uptime_seconds", help: "En marcha." });

    resistente.onCollect(() => {
      throw new Error("no se pudo leer");
    });
    resistente.onCollect(() => {
      gauge.set(42);
    });

    // El endpoint de métricas es lo que se consulta cuando algo va mal. Que se
    // caiga justo entonces sería el peor momento posible.
    expect(resistente.render()).toContain("agentinmobi_uptime_seconds 42");
    expect(logger.entries.some((entry) => entry.level === "warn")).toBe(true);
  });

  it("los valores calculados al exponer se refrescan en cada lectura", () => {
    let ticks = 0;
    const gauge = metrics.gauge({ name: "ticks", help: "Cuenta." });
    metrics.onCollect(() => {
      ticks += 1;
      gauge.set(ticks);
    });

    expect(metrics.render()).toContain("agentinmobi_ticks 1");
    expect(metrics.render()).toContain("agentinmobi_ticks 2");
  });

  it("termina en salto de línea", () => {
    metrics.counter({ name: "c_total", help: "Cosas." }).inc();

    // Sin él, algunos analizadores descartan la última muestra en silencio.
    expect(metrics.render().endsWith("\n")).toBe(true);
  });
});

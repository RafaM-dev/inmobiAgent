import { LATENCY_BUCKETS, type Counter, type Gauge, type Histogram, type Metrics } from "./metrics";

/**
 * CATÁLOGO DE MÉTRICAS del producto.
 *
 * Un solo archivo que se lee como la respuesta a "¿qué vigilamos?". Está aquí y
 * no repartido por los módulos a propósito: cuando cada sitio declara sus
 * propias métricas, en seis meses hay tres formas de contar lo mismo con tres
 * nombres parecidos y ningún panel que sume bien.
 *
 * Las métricas están elegidas para responder, en este orden, las preguntas de
 * quien está de guardia:
 *
 *   1. ¿Entra tráfico?           `inbound_messages_total`, `http_requests_total`
 *   2. ¿Se está atendiendo?      `agent_turns_total{status}`
 *   3. ¿Va lento, y dónde?       los histogramas de HTTP, modelo y herramientas
 *   4. ¿Se acumula trabajo?      `outbox_lag_seconds`
 *   5. ¿Qué versión corre?       `build_info`
 *
 * Ninguna lleva `tenantId` (D64). El detalle por inmobiliaria está en la base y
 * en los logs; las métricas dicen "cuánto y cómo de rápido", no "a quién".
 */

/**
 * Cubos del retraso del outbox, en segundos.
 *
 * Llegan hasta cinco minutos porque lo que interesa no es el caso normal —el
 * relay sondea cada medio segundo— sino la cola de la distribución: si aparece
 * masa por encima de treinta segundos, el worker no da abasto o está atascado
 * reintentando, y eso se traduce en clientes esperando respuesta.
 */
const LAG_BUCKETS: readonly number[] = [0.1, 0.5, 1, 2, 5, 15, 30, 60, 300];

export interface AppMetrics {
  readonly httpRequests: Counter;
  readonly httpDuration: Histogram;

  readonly inboundMessages: Counter;

  readonly agentTurns: Counter;
  readonly agentTurnDuration: Histogram;
  readonly agentTurnTokens: Counter;
  readonly agentTurnCostUsd: Counter;
  /** Turnos que NO llegaron al modelo por una puerta: gasto o ritmo. */
  readonly agentTurnsBlocked: Counter;

  readonly llmRequests: Counter;
  readonly llmDuration: Histogram;

  readonly toolCalls: Counter;
  readonly toolDuration: Histogram;

  readonly outboxDelivered: Counter;
  readonly outboxRetried: Counter;
  readonly outboxDeadLettered: Counter;
  readonly outboxLag: Histogram;

  readonly buildInfo: Gauge;
  readonly processUptime: Gauge;
  readonly processHeapBytes: Gauge;
}

export const createAppMetrics = (metrics: Metrics): AppMetrics => ({
  httpRequests: metrics.counter({
    name: "http_requests_total",
    help: "Peticiones HTTP atendidas.",
    // `route` es el PATRÓN de Fastify (`/api/leads/:id`), nunca la URL con el
    // identificador dentro: eso sería una serie por lead.
    labelNames: ["method", "route", "status"],
  }),
  httpDuration: metrics.histogram({
    name: "http_request_duration_seconds",
    help: "Tiempo de atención de una petición HTTP.",
    labelNames: ["method", "route"],
  }),

  inboundMessages: metrics.counter({
    name: "inbound_messages_total",
    help: "Mensajes entrantes por canal y desenlace (aceptado, limitado, rechazado).",
    labelNames: ["channel", "outcome"],
  }),

  agentTurns: metrics.counter({
    name: "agent_turns_total",
    help: "Turnos del agente por desenlace.",
    labelNames: ["status"],
  }),
  agentTurnDuration: metrics.histogram({
    name: "agent_turn_duration_seconds",
    help: "Duración de un turno completo del agente, de extremo a extremo.",
    labelNames: ["status"],
  }),
  agentTurnTokens: metrics.counter({
    name: "agent_tokens_total",
    help: "Tokens consumidos por el agente, de entrada y de salida.",
    labelNames: ["kind"],
  }),
  agentTurnCostUsd: metrics.counter({
    name: "agent_cost_usd_total",
    help: "Coste estimado acumulado en dólares. Contraste rápido con la factura real.",
    labelNames: ["provider"],
  }),
  agentTurnsBlocked: metrics.counter({
    name: "agent_turns_blocked_total",
    help: "Turnos que no llegaron al modelo, por el motivo que los paró.",
    labelNames: ["reason"],
  }),

  llmRequests: metrics.counter({
    name: "llm_requests_total",
    help: "Llamadas al proveedor de IA por desenlace.",
    labelNames: ["provider", "model", "outcome"],
  }),
  llmDuration: metrics.histogram({
    name: "llm_request_duration_seconds",
    help: "Latencia de una llamada al proveedor de IA.",
    labelNames: ["provider", "model"],
    // Un modelo local en CPU tarda mucho más que una API: los cubos por defecto
    // se quedarían todos en `+Inf` y el percentil no diría nada.
    buckets: [...LATENCY_BUCKETS, 20, 30, 60, 120],
  }),

  toolCalls: metrics.counter({
    name: "agent_tool_calls_total",
    help: "Ejecuciones de herramientas del agente por desenlace.",
    labelNames: ["tool", "outcome"],
  }),
  toolDuration: metrics.histogram({
    name: "agent_tool_duration_seconds",
    help: "Duración de una ejecución de herramienta.",
    labelNames: ["tool"],
  }),

  outboxDelivered: metrics.counter({
    name: "outbox_delivered_total",
    help: "Eventos publicados por el relay del outbox.",
    labelNames: ["event"],
  }),
  outboxRetried: metrics.counter({
    name: "outbox_retried_total",
    help: "Entregas fallidas reprogramadas con backoff.",
    labelNames: ["event"],
  }),
  outboxDeadLettered: metrics.counter({
    name: "outbox_dead_lettered_total",
    help: "Eventos que agotaron sus intentos. Cualquier valor distinto de cero se investiga.",
    labelNames: ["event"],
  }),
  outboxLag: metrics.histogram({
    name: "outbox_lag_seconds",
    help: "Tiempo entre que se encoló un evento y se entregó. La señal de saturación.",
    labelNames: ["event"],
    buckets: LAG_BUCKETS,
  }),

  buildInfo: metrics.gauge({
    name: "build_info",
    help: "Siempre 1. Sus etiquetas dicen qué versión y con qué proveedores corre.",
    labelNames: ["version", "environment", "llm_provider", "embedding_provider"],
  }),
  processUptime: metrics.gauge({
    name: "process_uptime_seconds",
    help: "Segundos desde que arrancó el proceso. Un reinicio se ve como una caída a cero.",
  }),
  processHeapBytes: metrics.gauge({
    name: "process_heap_used_bytes",
    help: "Memoria en uso del montón de V8.",
  }),
});

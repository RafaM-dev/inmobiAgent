/**
 * CUBO DE FICHAS (token bucket) — la primitiva de todos los límites de ritmo.
 *
 * Función pura: entra un estado y un instante, sale una decisión y el estado
 * siguiente. No hay reloj, ni mapa, ni base de datos. Todo eso son detalles de
 * dónde se guarda el cubo, y por eso viven en el adaptador.
 *
 * **Por qué un cubo de fichas y no una ventana fija.** La ventana fija —"200
 * mensajes por minuto"— deja pasar 400 mensajes en dos segundos si caen a
 * caballo del cambio de minuto: el peor caso es justo el doble del límite que
 * creías haber puesto. El registro deslizante no tiene ese defecto pero guarda
 * una marca de tiempo por petición, y eso es memoria proporcional al tráfico.
 * El cubo de fichas cuesta dos números por clave y describe el tráfico real
 * mejor que ninguno de los dos: una RÁFAGA que se tolera (el cubo lleno) y un
 * RITMO SOSTENIDO que se repone (las fichas que caen). Un proveedor de canal
 * entrega un lote y luego gotea; un bucle roto martillea sin parar. El primero
 * pasa, el segundo se corta.
 */

export interface Quota {
  /** Fichas que caben en el cubo: la RÁFAGA máxima que se tolera de golpe. */
  readonly burst: number;
  /** Fichas que se reponen por minuto: el RITMO SOSTENIDO permitido. */
  readonly perMinute: number;
}

export interface BucketState {
  /** Fichas disponibles en `updatedAtMs`. Fraccionario a propósito. */
  readonly tokens: number;
  readonly updatedAtMs: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Fichas que quedan tras la decisión, redondeadas hacia abajo. */
  readonly remaining: number;
  /** Milisegundos hasta que el intento tendría sentido. `0` si pasó. */
  readonly retryAfterMs: number;
}

export interface BucketOutcome {
  readonly decision: RateLimitDecision;
  /** Estado a guardar. Se guarda SIEMPRE, también cuando se rechaza. */
  readonly state: BucketState;
}

const MS_PER_MINUTE = 60_000;

/**
 * Una cuota inactiva no limita nada.
 *
 * Misma lectura que el tope de gasto: cero significa "sin límite", no "no pasa
 * ni uno". Es lo que evita que a alguien se le apague el producto por un valor
 * que no configuró.
 */
export const isQuotaActive = (quota: Quota): boolean =>
  quota.perMinute > 0 && quota.burst > 0;

/** Cubo recién creado: lleno. Quien nunca ha pedido nada no debe nada. */
export const fullBucket = (quota: Quota, nowMs: number): BucketState => ({
  tokens: quota.burst,
  updatedAtMs: nowMs,
});

/**
 * Fichas disponibles en `nowMs`, reponiendo de forma continua.
 *
 * La reposición es proporcional al tiempo transcurrido, no por saltos de un
 * minuto: con saltos, quien pide justo antes del salto espera casi un minuto
 * entero y quien pide justo después no espera nada, y el mismo tráfico da
 * experiencias distintas según la hora a la que llegue.
 */
const refill = (state: BucketState, quota: Quota, nowMs: number): number => {
  // Nunca hacia atrás: un reloj que retrocede (NTP, hibernación) no puede
  // quitar fichas ya repuestas.
  const elapsedMs = Math.max(0, nowMs - state.updatedAtMs);
  const restored = (elapsedMs / MS_PER_MINUTE) * quota.perMinute;
  return Math.min(quota.burst, state.tokens + restored);
};

/**
 * Intenta gastar `cost` fichas.
 *
 * **El coste se recorta al tamaño del cubo, y esto no es un detalle.** Un lote
 * de doscientos mensajes contra un cubo de ciento veinte no se puede pagar
 * jamás: sin el recorte, el proveedor reintentaría ese lote para siempre y
 * ninguno de sus mensajes entraría nunca. Recortar convierte "imposible" en
 * "cuesta el cubo entero", que es caro pero termina.
 */
export const consume = (input: {
  state: BucketState;
  quota: Quota;
  nowMs: number;
  /** Fichas que cuesta la operación. Un lote cuesta lo que trae, no uno. */
  cost?: number;
}): BucketOutcome => {
  const { state, quota, nowMs } = input;
  const cost = Math.min(Math.max(input.cost ?? 1, 0), quota.burst);
  const available = refill(state, quota, nowMs);

  if (available < cost) {
    const retryAfterMs = Math.ceil(((cost - available) / quota.perMinute) * MS_PER_MINUTE);

    return {
      decision: { allowed: false, remaining: Math.floor(available), retryAfterMs },
      /*
       * El estado avanza aunque no se gaste nada: se guardan las fichas
       * repuestas y el instante. Si un rechazo dejara el cubo congelado en su
       * `updatedAtMs` viejo, la siguiente petición volvería a contar el mismo
       * tiempo transcurrido y se repondrían las mismas fichas dos veces.
       */
      state: { tokens: available, updatedAtMs: nowMs },
    };
  }

  const tokens = available - cost;
  return {
    decision: { allowed: true, remaining: Math.floor(tokens), retryAfterMs: 0 },
    state: { tokens, updatedAtMs: nowMs },
  };
};

/**
 * Instante en el que el cubo volverá a estar lleno.
 *
 * Sirve para tirar claves inactivas sin cambiar ningún comportamiento: un cubo
 * lleno es indistinguible de uno que nunca existió, así que borrarlo no pierde
 * información. Es lo que permite que el limitador en memoria no crezca sin fin.
 */
export const fullAgainAtMs = (state: BucketState, quota: Quota, nowMs: number): number => {
  const missing = Math.max(0, quota.burst - state.tokens);
  return nowMs + Math.ceil((missing / quota.perMinute) * MS_PER_MINUTE);
};

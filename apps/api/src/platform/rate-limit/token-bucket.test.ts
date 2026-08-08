import { describe, expect, it } from "vitest";
import {
  consume,
  fullAgainAtMs,
  fullBucket,
  isQuotaActive,
  type BucketState,
  type Quota,
} from "./token-bucket";

const quota: Quota = { burst: 10, perMinute: 60 };
const T0 = 1_000_000;

/** Gasta `times` fichas seguidas sin que avance el reloj. */
const drain = (state: BucketState, times: number, nowMs = T0): BucketState => {
  let current = state;
  for (let i = 0; i < times; i += 1) {
    current = consume({ state: current, quota, nowMs }).state;
  }
  return current;
};

describe("Cubo de fichas", () => {
  it("un cubo nuevo está lleno: quien nunca ha pedido nada no debe nada", () => {
    const { decision } = consume({ state: fullBucket(quota, T0), quota, nowMs: T0 });

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(9);
  });

  it("tolera la ráfaga completa de golpe y corta la siguiente", () => {
    const vacio = drain(fullBucket(quota, T0), 10);

    // Diez pasaron sin que el reloj avanzara: eso es la ráfaga.
    const undecimo = consume({ state: vacio, quota, nowMs: T0 });

    expect(undecimo.decision.allowed).toBe(false);
    expect(undecimo.decision.remaining).toBe(0);
  });

  it("repone de forma continua, no a saltos de minuto", () => {
    const vacio = drain(fullBucket(quota, T0), 10);

    // 60 por minuto = una por segundo. Medio segundo no alcanza; uno sí.
    expect(consume({ state: vacio, quota, nowMs: T0 + 500 }).decision.allowed).toBe(false);
    expect(consume({ state: vacio, quota, nowMs: T0 + 1_000 }).decision.allowed).toBe(true);
  });

  it("nunca acumula más fichas que la ráfaga", () => {
    const vacio = drain(fullBucket(quota, T0), 10);

    // Una hora parado no da derecho a una hora de tráfico de golpe.
    const trasUnaHora = consume({ state: vacio, quota, nowMs: T0 + 3_600_000 });

    expect(trasUnaHora.decision.remaining).toBe(9);
  });

  it("dice cuánto hay que esperar, y esperarlo funciona", () => {
    const vacio = drain(fullBucket(quota, T0), 10);
    const rechazo = consume({ state: vacio, quota, nowMs: T0, cost: 3 });

    expect(rechazo.decision.allowed).toBe(false);
    // Tres fichas a una por segundo.
    expect(rechazo.decision.retryAfterMs).toBe(3_000);

    const reintento = consume({
      state: rechazo.state,
      quota,
      nowMs: T0 + rechazo.decision.retryAfterMs,
      cost: 3,
    });
    expect(reintento.decision.allowed).toBe(true);
  });

  it("un rechazo no congela el cubo", () => {
    const vacio = drain(fullBucket(quota, T0), 10);

    /*
     * El fallo que esto vigila: si el estado guardado tras un rechazo
     * conservara el `updatedAtMs` viejo, la petición siguiente volvería a
     * contar los mismos segundos transcurridos y repondría dos veces las
     * mismas fichas — un límite que se relaja cuanto más se le insiste.
     */
    const rechazado = consume({ state: vacio, quota, nowMs: T0 + 500 });
    expect(rechazado.state.updatedAtMs).toBe(T0 + 500);

    const medioSegundoDespues = consume({ state: rechazado.state, quota, nowMs: T0 + 1_000 });
    expect(medioSegundoDespues.decision.allowed).toBe(true);
    // Y solo una: se repuso una ficha en total, no dos.
    expect(consume({ state: medioSegundoDespues.state, quota, nowMs: T0 + 1_000 }).decision.allowed)
      .toBe(false);
  });

  it("un reloj que retrocede no quita fichas ya repuestas", () => {
    const vacio = drain(fullBucket(quota, T0), 10);
    const repuesto = consume({ state: vacio, quota, nowMs: T0 + 5_000 }).state;

    // NTP ajusta el reloj hacia atrás. No puede volverse contra el cliente.
    const decision = consume({ state: repuesto, quota, nowMs: T0 }).decision;
    expect(decision.allowed).toBe(true);
  });

  it("un lote más grande que el cubo cuesta el cubo entero, no es imposible", () => {
    /*
     * Sin recortar el coste, un lote de 25 contra un cubo de 10 no se podría
     * pagar NUNCA: el proveedor lo reintentaría para siempre y ninguno de sus
     * mensajes entraría jamás. Recortar lo hace caro, pero terminable.
     */
    const lote = consume({ state: fullBucket(quota, T0), quota, nowMs: T0, cost: 25 });

    expect(lote.decision.allowed).toBe(true);
    expect(lote.decision.remaining).toBe(0);
  });

  it("un lote cuesta lo que trae, no una ficha", () => {
    const trasLote = consume({ state: fullBucket(quota, T0), quota, nowMs: T0, cost: 4 }).state;

    expect(trasLote.tokens).toBe(6);
  });

  it("una cuota en cero significa sin límite, no bloqueado", () => {
    // Misma lectura que el tope de gasto: nadie se queda sin producto por un
    // valor que no configuró.
    expect(isQuotaActive({ burst: 0, perMinute: 60 })).toBe(false);
    expect(isQuotaActive({ burst: 10, perMinute: 0 })).toBe(false);
    expect(isQuotaActive(quota)).toBe(true);
  });

  it("sabe cuándo el cubo volverá a estar lleno", () => {
    const vacio = drain(fullBucket(quota, T0), 10);

    // Diez fichas a una por segundo.
    expect(fullAgainAtMs(vacio, quota, T0)).toBe(T0 + 10_000);
    expect(fullAgainAtMs(fullBucket(quota, T0), quota, T0)).toBe(T0);
  });
});

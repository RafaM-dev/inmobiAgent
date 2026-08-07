import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withDatabase, type DatabaseContext } from "../support/integration-harness";
import type { EventEnvelope } from "../../src/platform/events/event";
import { PrismaOutboxStore } from "../../src/platform/database/prisma-outbox-store";

/**
 * OUTBOX contra Postgres de verdad.
 *
 * `reserveBatch` es SQL crudo porque Prisma no expone `FOR UPDATE SKIP LOCKED`,
 * y esa cláusula es justamente lo que permite desplegar varias réplicas del
 * worker sin entregar el mismo evento dos veces. Un doble en memoria puede
 * fingir que reserva; solo Postgres demuestra que dos transacciones
 * simultáneas no se llevan la misma fila.
 *
 * Si esto falla, el síntoma en producción es un cliente recibiendo la misma
 * respuesta dos veces — o ninguna.
 */

/**
 * Los tiempos van RELATIVOS al reloj real, no a una fecha fija.
 *
 * `available_at` lo pone Postgres con su propio `now()` al insertar. Con fechas
 * literales del pasado, `available_at <= now` nunca se cumple y la reserva
 * devuelve vacío — que fue exactamente lo que pasó la primera vez.
 */
const ahora = (): Date => new Date();
const enMinutos = (minutos: number): Date => new Date(Date.now() + minutos * 60_000);

const envelope = (n: number): EventEnvelope => ({
  eventId: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
  type: "test.event",
  version: 1,
  tenantId: "tenant-de-pruebas",
  occurredAt: new Date("2026-03-01T10:00:00.000Z"),
  correlationId: "corr-1",
  payload: { n },
});

describe("PrismaOutboxStore (Postgres real)", () => {
  let context: DatabaseContext;
  let store: PrismaOutboxStore;

  beforeAll(async () => {
    context = await withDatabase();
    store = new PrismaOutboxStore(context.database);
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
  });

  it("dos workers simultáneos no se llevan el mismo evento", async () => {
    for (let n = 1; n <= 6; n += 1) await store.enqueue(envelope(n));

    const now = ahora();

    /*
     * Las dos reservas se lanzan a la vez, sin `await` entre ellas: es la
     * situación real de dos réplicas del worker despertando en el mismo
     * milisegundo. Sin SKIP LOCKED, una de las dos se quedaría bloqueada
     * esperando a la otra, o peor, ambas leerían las mismas filas.
     */
    const [primeraTanda, segundaTanda] = await Promise.all([
      store.reserveBatch(3, now),
      store.reserveBatch(3, now),
    ]);

    const ids = [...primeraTanda, ...segundaTanda].map((r) => r.envelope.eventId);
    expect(ids).toHaveLength(6);
    // Ningún evento reservado dos veces.
    expect(new Set(ids).size).toBe(6);
  });

  it("un lote reservado deja de estar disponible mientras se entrega", async () => {
    for (let n = 1; n <= 3; n += 1) await store.enqueue(envelope(n));

    const primera = await store.reserveBatch(10, ahora());
    expect(primera).toHaveLength(3);

    /*
     * ESTE es el caso que destapó el fallo, y no el simultáneo.
     *
     * El relay reserva un lote y después entrega los eventos UNO A UNO,
     * ejecutando manejadores por medio. Durante todo ese rato el bloqueo de
     * `FOR UPDATE SKIP LOCKED` ya no existe —murió con la sentencia—, así que
     * una segunda réplica que sondeara un segundo más tarde se llevaba el mismo
     * lote entero y lo entregaba otra vez.
     */
    const otraReplica = await store.reserveBatch(10, ahora());
    expect(otraReplica).toHaveLength(0);
  });

  it("un worker que muere a mitad no pierde los eventos", async () => {
    await store.enqueue(envelope(1));

    // Reservado y nunca resuelto: el proceso se cayó entre medias.
    expect(await store.reserveBatch(10, ahora())).toHaveLength(1);
    expect(await store.reserveBatch(10, enMinutos(0.5))).toHaveLength(0);

    // Pasado el plazo de invisibilidad vuelve a la cola. Es un aplazamiento,
    // nunca una pérdida.
    const recuperado = await store.reserveBatch(10, enMinutos(2));
    expect(recuperado).toHaveLength(1);
    expect(recuperado[0]?.attempts).toBe(1);
  });

  it("no entrega eventos cuyo momento aún no ha llegado", async () => {
    await store.enqueue(envelope(1));

    const reprogramados = await store.reserveBatch(10, ahora());
    expect(reprogramados).toHaveLength(1);

    const registro = reprogramados[0];
    expect(registro).toBeDefined();
    if (!registro) return;

    await store.markFailed(registro.id, "fallo simulado", enMinutos(5));

    // Un minuto después todavía no toca.
    const pronto = await store.reserveBatch(10, enMinutos(1));
    expect(pronto).toHaveLength(0);

    // Pasado el backoff, vuelve a estar disponible.
    const luego = await store.reserveBatch(10, enMinutos(6));
    expect(luego).toHaveLength(1);
    // El contador de intentos sobrevive al reintento: sin él, un evento que
    // siempre falla se reintentaría eternamente.
    expect(luego[0]?.attempts).toBe(1);
  });

  it("un evento publicado no se vuelve a entregar", async () => {
    await store.enqueue(envelope(1));

    const reservados = await store.reserveBatch(10, ahora());
    await store.markPublished(
      reservados.map((r) => r.id),
      ahora(),
    );

    const otraVez = await store.reserveBatch(10, enMinutos(60));
    expect(otraVez).toHaveLength(0);
  });

  it("un evento en dead-letter deja de reintentarse y conserva el motivo", async () => {
    await store.enqueue(envelope(1));

    const reservados = await store.reserveBatch(10, ahora());
    const registro = reservados[0];
    expect(registro).toBeDefined();
    if (!registro) return;

    await store.markDeadLettered(registro.id, "el manejador nunca va a funcionar");

    expect(await store.reserveBatch(10, enMinutos(1440))).toHaveLength(0);

    const fila = await context.prisma.outboxEvent.findUnique({ where: { id: registro.id } });
    // El motivo se conserva: un evento que se rindió sin dejar rastro es un
    // dato perdido que nadie sabrá que perdió.
    expect(fila?.status).toBe("DEAD_LETTERED");
    expect(fila?.lastError).toContain("nunca va a funcionar");
  });

  it("el evento encolado dentro de una transacción que falla no se entrega", async () => {
    await expect(
      context.database.run(async () => {
        await store.enqueue(envelope(1));
        throw new Error("el caso de uso falló después de encolar");
      }),
    ).rejects.toThrow("el caso de uso falló");

    /*
     * Esta es la razón de ser del outbox transaccional: el evento y el cambio
     * de estado viven o mueren juntos. Si se hubiera publicado, habría un aviso
     * de algo que nunca ocurrió.
     */
    expect(await context.prisma.outboxEvent.count()).toBe(0);
  });

  it("conserva el orden: lo que lleva más tiempo esperando sale primero", async () => {
    for (let n = 1; n <= 3; n += 1) await store.enqueue(envelope(n));

    const lote = await store.reserveBatch(3, ahora());
    const orden = lote.map((r) => (r.envelope.payload as { n: number }).n);

    expect(orden).toEqual([1, 2, 3]);
  });
});

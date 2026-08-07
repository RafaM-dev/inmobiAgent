import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient } from "../../generated/prisma/client";
import type { AppConfig } from "../config/env";
import type { Logger } from "../logging/logger";
import { TenantContext } from "../tenancy/tenant-context";
import type { UnitOfWork } from "./unit-of-work";

/**
 * Cliente transaccional de Prisma: o el cliente base, o el cliente ligado a la
 * transacción activa. Los repositorios siempre piden este tipo.
 */
export type PrismaTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Acceso a la base de datos.
 *
 * La transacción activa se propaga por AsyncLocalStorage en lugar de pasarse
 * como parámetro por toda la pila de llamadas. Consecuencia práctica: un
 * repositorio y el OutboxStore invocados dentro del mismo `uow.run()` comparten
 * transacción sin que el caso de uso tenga que coordinarlos.
 */
/**
 * Valor que abre la puerta entre inmobiliarias en las políticas de RLS.
 *
 * Existe para el seed y el mantenimiento. Que haya que escribirlo es la
 * propiedad importante: cruzar la frontera es posible, pero nunca por accidente
 * — y `grep` encuentra en un segundo cada sitio que lo hace.
 */
export const RLS_ALL_TENANTS = "*";

export class Database implements UnitOfWork {
  private readonly txStorage = new AsyncLocalStorage<PrismaTx>();

  /**
   * Cliente para consultas FUERA de transacción.
   *
   * Es la mitad difícil de RLS. `SET LOCAL` necesita una transacción, y la
   * mayoría de las lecturas no abren ninguna: sin esto verían cero filas en
   * cuanto se activaran las políticas.
   *
   * La extensión envuelve cada operación suelta en una transacción de dos
   * sentencias —fijar el tenant y consultar— para que ambas caigan en la MISMA
   * conexión del pool. Sin esa garantía, el `set_config` podría acabar en una
   * conexión y la consulta en otra.
   *
   * **Cuesta un viaje de ida y vuelta extra por consulta suelta.** Es un precio
   * real y consciente: la alternativa es que el aislamiento entre inmobiliarias
   * dependa de que ningún repositorio se olvide nunca de filtrar, y ya sabemos
   * que eso falla — un `findById` sin ámbito sobrevivió seis fases.
   */
  private readonly scoped: PrismaTx;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
  ) {
    this.scoped = prisma.$extends({
      query: {
        async $allOperations({ args, query }) {
          const tenantId = TenantContext.peek()?.tenantId;

          // Sin contexto no se fija nada, y las tablas protegidas devuelven
          // cero. Es lo correcto: leer datos de negocio sin saber de quién son
          // es siempre un error, y aquí falla en silencio y en seguro en vez de
          // devolver los de otra inmobiliaria.
          if (tenantId === undefined) return (await query(args)) as unknown;

          /*
           * `unknown` y no `any`: la extensión es genérica sobre todas las
           * operaciones, así que Prisma no puede tipar el resultado aquí. Lo
           * que se devuelve es exactamente lo que devolvió `query(args)`, y
           * quien llama sí lo tiene tipado.
           */
          const results = (await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`,
            query(args),
          ])) as unknown[];

          return results[1];
        },
      },
    }) as unknown as PrismaTx;
  }

  /** Cliente a usar por los repositorios. Nunca guardes su resultado en un campo. */
  client(): PrismaTx {
    return this.txStorage.getStore() ?? this.scoped;
  }

  /** Escotilla para SQL crudo (pgvector, SKIP LOCKED, advisory locks). */
  raw(): PrismaClient {
    return this.prisma;
  }

  /**
   * Unidad de trabajo, y el sitio donde RLS recibe el tenant.
   *
   * `SET LOCAL` solo dura la transacción, y esa es exactamente la garantía que
   * hace falta con un pool de conexiones: al terminar, el ajuste desaparece con
   * ella. Fijarlo a nivel de sesión lo dejaría pegado a la conexión, y la
   * siguiente petición que la reutilizara heredaría el tenant de la anterior —
   * un fallo mucho peor que no tener RLS, porque devolvería datos ajenos en vez
   * de ninguno.
   *
   * Sin contexto de tenant no se fija nada: la política falla cerrada y la
   * transacción no ve ni una fila de las tablas protegidas. Es deliberado —
   * escribir datos de negocio sin saber de quién son es siempre un error.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    // Transacción anidada: se une a la existente en vez de abrir otra.
    const existing = this.txStorage.getStore();
    if (existing) return fn();

    const tenantId = TenantContext.peek()?.tenantId;

    return this.prisma.$transaction(
      async (tx) => {
        if (tenantId !== undefined) {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
        }
        return this.txStorage.run(tx, fn);
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
  }

  /**
   * Ejecuta algo con acceso a TODAS las inmobiliarias.
   *
   * Solo para el seed y el mantenimiento. No es una escotilla cómoda: abre una
   * transacción propia y deja rastro en el log, precisamente para que usarla en
   * el camino de una petición cante.
   */
  async runAcrossTenants<T>(reason: string, fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
    this.logger.warn("Acceso entre inmobiliarias", { reason });

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${RLS_ALL_TENANTS}, TRUE)`;
        return this.txStorage.run(tx, () => fn(tx));
      },
      { maxWait: 5_000, timeout: 60_000 },
    );
  }

  async connect(): Promise<void> {
    await this.prisma.$connect();
    this.logger.info("Conexión a base de datos establecida");
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
    this.logger.info("Conexión a base de datos cerrada");
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
    const startedAt = performance.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, latencyMs: Math.round(performance.now() - startedAt) };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - startedAt),
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export const createPrismaClient = (config: AppConfig, logger: Logger): PrismaClient => {
  const prisma = new PrismaClient({
    datasources: { db: { url: config.database.url } },
    log: config.isProduction
      ? [{ emit: "event", level: "warn" }, { emit: "event", level: "error" }]
      : [
          { emit: "event", level: "query" },
          { emit: "event", level: "warn" },
          { emit: "event", level: "error" },
        ],
  });

  if (!config.isProduction) {
    prisma.$on("query", (e) => {
      // Solo consultas lentas: el ruido esconde los problemas reales.
      if (e.duration >= 100) {
        logger.debug("Consulta SQL lenta", { durationMs: e.duration, query: e.query });
      }
    });
  }
  prisma.$on("warn", (e) => {
    logger.warn("Aviso de Prisma", { target: e.target, message: e.message });
  });
  prisma.$on("error", (e) => {
    logger.error("Error de Prisma", { target: e.target, message: e.message });
  });

  return prisma;
};

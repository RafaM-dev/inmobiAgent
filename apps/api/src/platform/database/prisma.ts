import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient } from "../../generated/prisma/client";
import type { AppConfig } from "../config/env";
import type { Logger } from "../logging/logger";
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
export class Database implements UnitOfWork {
  private readonly txStorage = new AsyncLocalStorage<PrismaTx>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
  ) {}

  /** Cliente a usar por los repositorios. Nunca guardes su resultado en un campo. */
  client(): PrismaTx {
    return this.txStorage.getStore() ?? this.prisma;
  }

  /** Escotilla para SQL crudo (pgvector, SKIP LOCKED, advisory locks). */
  raw(): PrismaClient {
    return this.prisma;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    // Transacción anidada: se une a la existente en vez de abrir otra.
    const existing = this.txStorage.getStore();
    if (existing) return fn();

    return this.prisma.$transaction((tx) => this.txStorage.run(tx, fn), {
      maxWait: 5_000,
      timeout: 15_000,
    });
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

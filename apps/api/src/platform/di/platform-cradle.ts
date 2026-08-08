import type { PrismaClient } from "../../generated/prisma/client";
import type { Clock } from "../clock/clock";
import type { AppConfig } from "../config/env";
import type { Database } from "../database/prisma";
import type { UnitOfWork } from "../database/unit-of-work";
import type { EventBus, IdempotencyStore } from "../events/event-bus";
import type { EventPublisher } from "../events/event-publisher";
import type { OutboxRelay, OutboxStore } from "../events/outbox";
import type { IdGenerator } from "../ids/id-generator";
import type { Logger } from "../logging/logger";
import type { RateLimiter } from "../rate-limit/rate-limiter";
import type { FileStorage } from "../storage/file-storage";

/**
 * Servicios transversales disponibles para todos los módulos.
 *
 * Vive en `platform/di` y no en `bootstrap/` para que un módulo pueda tipar su
 * registro contra el kernel sin importar el composition root. Sin esto habría
 * un ciclo: bootstrap conoce los módulos y los módulos conocerían bootstrap.
 */
export interface PlatformCradle {
  config: AppConfig;
  logger: Logger;
  clock: Clock;
  ids: IdGenerator;

  prismaClient: PrismaClient;
  database: Database;
  unitOfWork: UnitOfWork;
  /** Originales de los archivos: hoy en disco, mañana en S3 (D27). */
  fileStorage: FileStorage;
  /** Ritmo tolerado por clave: hoy en memoria, mañana en Redis (D58). */
  rateLimiter: RateLimiter;

  outboxStore: OutboxStore;
  idempotencyStore: IdempotencyStore;
  /** Lado EMISIÓN: es lo que usan los casos de uso. Transaccional. */
  eventPublisher: EventPublisher;
  /** Lado ENTREGA: suscripciones y despacho. Lo usa el relay. */
  eventBus: EventBus;
  outboxRelay: OutboxRelay;
}

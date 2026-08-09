import { asFunction, asValue, createContainer, InjectionMode, type AwilixContainer } from "awilix";
import { SystemClock } from "../platform/clock/clock";
import type { AppConfig } from "../platform/config/env";
import { createPrismaClient, Database } from "../platform/database/prisma";
import { PrismaIdempotencyStore } from "../platform/database/prisma-idempotency-store";
import { PrismaOutboxStore } from "../platform/database/prisma-outbox-store";
import type { UnitOfWork } from "../platform/database/unit-of-work";
import type { ModuleRegistration } from "../platform/di/app-module";
import type { PlatformCradle } from "../platform/di/platform-cradle";
import { InProcessEventBus } from "../platform/events/event-bus";
import { OutboxEventPublisher } from "../platform/events/event-publisher";
import { OutboxRelay } from "../platform/events/outbox";
import { UuidV7Generator } from "../platform/ids/id-generator";
import { createPinoRoot, PinoLogger } from "../platform/logging/pino-logger";
import { LogNotifier } from "../platform/notifications/log-notifier";
import type { Notifier } from "../platform/notifications/notifier";
import { SmtpNotifier } from "../platform/notifications/smtp-notifier";
import { InMemoryRateLimiter } from "../platform/rate-limit/in-memory-rate-limiter";
import type { RateLimiter } from "../platform/rate-limit/rate-limiter";
import type { FileStorage } from "../platform/storage/file-storage";
import { createAppMetrics } from "../platform/telemetry/app-metrics";
import { PrometheusMetrics } from "../platform/telemetry/prometheus-metrics";
import { LocalFileStorage } from "../platform/storage/local-file-storage";
import type { FastifyInstance } from "fastify";
import type { AgentCradle } from "../modules/agent";
import type { AppointmentsCradle } from "../modules/appointments";
import type { CatalogCradle } from "../modules/catalog";
import type { ChannelsCradle } from "../modules/channels";
import type { ConversationCradle } from "../modules/conversation";
import type { IdentityCradle } from "../modules/identity";
import type { KnowledgeCradle } from "../modules/knowledge";
import type { LeadsCradle } from "../modules/leads";

/**
 * COMPOSITION ROOT
 *
 * Único lugar del sistema donde las interfaces se atan a implementaciones
 * concretas. Es también el único archivo autorizado a mencionar adaptadores de
 * WhatsApp, proveedores de catálogo o SDKs de IA (ver .dependency-cruiser.cjs).
 *
 * Todo se registra de forma EXPLÍCITA con `asFunction`: sin auto-wiring mágico,
 * el grafo de dependencias se lee de arriba abajo y se audita en una pantalla.
 */

/**
 * Cradle de la aplicación: el kernel más lo que aporta cada módulo.
 *
 * La composición es explícita —una línea por módulo— en lugar de declaration
 * merging: se lee de un vistazo qué hay disponible en el contenedor y quién lo
 * pone. Cada módulo declara su propio `XCradle` en su `index.ts` y tipa su
 * registro contra `PlatformCradle & XCradle`, así que ningún módulo importa
 * este archivo y no hay ciclo entre bootstrap y modules.
 */
export interface AppCradle
  extends PlatformCradle,
    IdentityCradle,
    ChannelsCradle,
    ConversationCradle,
    CatalogCradle,
    LeadsCradle,
    AppointmentsCradle,
    KnowledgeCradle,
    AgentCradle {}

export type AppModule = ModuleRegistration<AppCradle, FastifyInstance>;

export const buildContainer = (config: AppConfig): AwilixContainer<AppCradle> => {
  const container = createContainer<AppCradle>({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });

  container.register({
    config: asValue(config),

    logger: asFunction((c: AppCradle) => new PinoLogger(createPinoRoot(c.config))).singleton(),

    /**
     * ÚNICO punto donde se elige dónde van las métricas.
     *
     * Hoy, un registro en proceso que se sirve en formato Prometheus. El día que
     * haya un colector, un adaptador OTLP detrás del mismo puerto `Metrics`
     * —o los dos a la vez—: ningún caso de uso se entera.
     */
    metricsRegistry: asFunction(
      (c: AppCradle) =>
        new PrometheusMetrics({ logger: c.logger.child({ component: "metrics" }) }),
    ).singleton(),
    appMetrics: asFunction((c: AppCradle) => createAppMetrics(c.metricsRegistry)).singleton(),
    clock: asFunction(() => new SystemClock()).singleton(),
    ids: asFunction(() => new UuidV7Generator()).singleton(),

    prismaClient: asFunction((c: AppCradle) => createPrismaClient(c.config, c.logger)).singleton(),
    database: asFunction((c: AppCradle) => new Database(c.prismaClient, c.logger)).singleton(),
    // La unidad de trabajo ES la base de datos: la transacción ambiental vive ahí.
    unitOfWork: asFunction((c: AppCradle): UnitOfWork => c.database).singleton(),

    /**
     * ÚNICO punto donde se elige dónde viven los archivos.
     *
     * Hoy solo existe el adaptador de disco, así que no hay `switch` que
     * escribir: `STORAGE_DRIVER` admite un único valor y el compilador lo sabe.
     * Cuando llegue el de S3 (D27), este es el sitio donde se elige.
     */
    fileStorage: asFunction(
      (c: AppCradle): FileStorage => new LocalFileStorage(c.config.storage.dir),
    ).singleton(),

    /**
     * ÚNICO punto donde se elige por dónde salen los avisos al equipo.
     *
     * `SMTP_HOST` es el interruptor, y no una variable propia de «modo demo»:
     * un interruptor aparte podría quedarse en `false` con SMTP perfectamente
     * configurado y nadie lo notaría hasta echar de menos un correo. Sin host
     * no hay a dónde enviar, y eso no se puede contradecir.
     */
    notifier: asFunction((c: AppCradle): Notifier => {
      if (!c.config.notifications.smtpEnabled) {
        return new LogNotifier({ logger: c.logger });
      }

      const { host, port, secure, user, password, from, timeoutMs } = c.config.notifications;
      return new SmtpNotifier({
        options: {
          host,
          port,
          secure,
          ...(user !== undefined ? { user } : {}),
          ...(password !== undefined ? { password } : {}),
          from,
          timeoutMs,
        },
        logger: c.logger,
      });
    }).singleton(),

    /**
     * ÚNICO punto donde se elige dónde se cuentan los ritmos.
     *
     * En memoria mientras haya un proceso; un adaptador de Redis detrás del
     * mismo puerto el día que haya varios (D58). El algoritmo —el cubo de
     * fichas— es una función pura que ambos comparten sin cambios.
     */
    rateLimiter: asFunction(
      (c: AppCradle): RateLimiter =>
        new InMemoryRateLimiter({
          clock: c.clock,
          logger: c.logger.child({ component: "rate-limiter" }),
        }),
    ).singleton(),

    outboxStore: asFunction((c: AppCradle) => new PrismaOutboxStore(c.database)).singleton(),
    idempotencyStore: asFunction(
      (c: AppCradle) => new PrismaIdempotencyStore(c.database),
    ).singleton(),

    eventPublisher: asFunction(
      (c: AppCradle) =>
        new OutboxEventPublisher({ outbox: c.outboxStore, clock: c.clock, ids: c.ids }),
    ).singleton(),

    eventBus: asFunction(
      (c: AppCradle) =>
        new InProcessEventBus({
          logger: c.logger.child({ component: "event-bus" }),
          clock: c.clock,
          ids: c.ids,
          idempotency: c.idempotencyStore,
        }),
    ).singleton(),

    outboxRelay: asFunction(
      (c: AppCradle) =>
        new OutboxRelay({
          store: c.outboxStore,
          bus: c.eventBus,
          clock: c.clock,
          logger: c.logger.child({ component: "outbox-relay" }),
          metrics: c.appMetrics,
        }),
    ).singleton(),
  });

  return container;
};

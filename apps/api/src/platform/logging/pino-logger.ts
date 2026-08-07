import { pino, type Logger as PinoInstance } from "pino";
import type { AppConfig } from "../config/env";
import { TenantContext } from "../tenancy/tenant-context";
import type { LogFields, Logger } from "./logger";

/**
 * Campos que jamás deben aparecer en un log.
 *
 * Manejamos conversaciones reales de compradores de vivienda: teléfonos,
 * nombres y credenciales de canal. La redacción es estructural, no un acuerdo
 * verbal entre desarrolladores.
 */
const REDACTED_PATHS = [
  "*.password",
  "*.apiKey",
  "*.accessToken",
  "*.authorization",
  "*.encryptionKey",
  "req.headers.authorization",
  "req.headers.cookie",
  "*.credentials",
  "*.phone",
  "*.phoneNumber",
  "*.email",
];

export const createPinoRoot = (config: AppConfig): PinoInstance =>
  pino({
    level: config.logging.level,
    base: { app: config.app.name, version: config.app.version, env: config.env },
    redact: { paths: REDACTED_PATHS, censor: "[redactado]" },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(config.logging.pretty
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname,app,version,env" },
          },
        }
      : {}),
  });

/**
 * Adaptador de pino al puerto `Logger`.
 *
 * Enriquece automáticamente cada línea con el ExecutionContext activo, de modo
 * que toda traza es rastreable por tenant y por conversación sin que quien
 * escribe el log tenga que acordarse.
 */
export class PinoLogger implements Logger {
  constructor(private readonly instance: PinoInstance) {}

  private enrich(fields?: LogFields): LogFields {
    const ctx = TenantContext.peek();
    if (!ctx) return fields ?? {};
    return {
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      ...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}),
      source: ctx.source,
      ...fields,
    };
  }

  trace(m: string, f?: LogFields): void {
    this.instance.trace(this.enrich(f), m);
  }
  debug(m: string, f?: LogFields): void {
    this.instance.debug(this.enrich(f), m);
  }
  info(m: string, f?: LogFields): void {
    this.instance.info(this.enrich(f), m);
  }
  warn(m: string, f?: LogFields): void {
    this.instance.warn(this.enrich(f), m);
  }
  error(m: string, f?: LogFields): void {
    this.instance.error(this.enrich(f), m);
  }
  fatal(m: string, f?: LogFields): void {
    this.instance.fatal(this.enrich(f), m);
  }

  child(fields: LogFields): Logger {
    return new PinoLogger(this.instance.child(fields));
  }
}

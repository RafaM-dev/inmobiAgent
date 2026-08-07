/**
 * Puerto de logging.
 *
 * Los casos de uso reciben un `Logger`, nunca `pino`. Cambiar de librería de
 * logs no debe tocar una sola línea de lógica de negocio.
 */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type LogFields = Record<string, unknown>;

export interface Logger {
  trace(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  fatal(message: string, fields?: LogFields): void;
  /** Crea un logger con campos fijos (tenantId, conversationId, correlationId). */
  child(fields: LogFields): Logger;
}

/** Logger nulo para tests que no verifican logs. */
export class NoopLogger implements Logger {
  trace(): void {}
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  fatal(): void {}
  child(): Logger {
    return this;
  }
}

/** Logger en memoria: permite aserciones sobre lo que se registró. */
export class InMemoryLogger implements Logger {
  readonly entries: { level: LogLevel; message: string; fields?: LogFields }[] = [];

  constructor(private readonly bound: LogFields = {}) {}

  private write(level: LogLevel, message: string, fields?: LogFields): void {
    this.entries.push({ level, message, fields: { ...this.bound, ...fields } });
  }

  trace(m: string, f?: LogFields): void {
    this.write("trace", m, f);
  }
  debug(m: string, f?: LogFields): void {
    this.write("debug", m, f);
  }
  info(m: string, f?: LogFields): void {
    this.write("info", m, f);
  }
  warn(m: string, f?: LogFields): void {
    this.write("warn", m, f);
  }
  error(m: string, f?: LogFields): void {
    this.write("error", m, f);
  }
  fatal(m: string, f?: LogFields): void {
    this.write("fatal", m, f);
  }
  child(fields: LogFields): Logger {
    const child = new InMemoryLogger({ ...this.bound, ...fields });
    // Comparte el buffer para poder aseverar sobre todo el árbol de loggers.
    Object.defineProperty(child, "entries", { value: this.entries });
    return child;
  }
}

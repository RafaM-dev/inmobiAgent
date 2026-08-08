import { ErrorCode } from "./error-codes";

export interface ErrorDetail {
  path: string;
  message: string;
}

export interface AppErrorOptions {
  message: string;
  code: ErrorCode;
  /** Estado HTTP sugerido. Solo lo usa la capa interface; el dominio lo ignora. */
  httpStatus?: number;
  details?: ErrorDetail[];
  /** `false` = bug nuestro. Se alerta y se registra con stack completo. */
  operational?: boolean;
  /** Datos estructurados para el log. Nunca se exponen al cliente. */
  context?: Record<string, unknown>;
  cause?: unknown;
}

/**
 * Error base del sistema. Todo error que cruce una frontera de capa es un
 * AppError: así la capa interface siempre sabe cómo serializarlo y el logger
 * siempre encuentra `code` y `context`.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details: ErrorDetail[] | undefined;
  readonly operational: boolean;
  readonly context: Record<string, unknown> | undefined;

  constructor(options: AppErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code;
    this.httpStatus = options.httpStatus ?? 500;
    this.details = options.details;
    this.operational = options.operational ?? true;
    this.context = options.context;
    Error.captureStackTrace(this, new.target);
  }

  /** Proyección segura para el cliente: nunca incluye `context` ni el stack. */
  toPublicJSON(correlationId?: string): {
    error: { code: string; message: string; details?: ErrorDetail[]; correlationId?: string };
  } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
        ...(correlationId ? { correlationId } : {}),
      },
    };
  }
}

/* -------------------------------------------------------------------------- *
 * Errores concretos. Constructores estrechos para que llamarlos sea trivial.
 * -------------------------------------------------------------------------- */

/** Violación de una regla de negocio. Vive en el dominio. */
export class DomainError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super({
      message,
      code: ErrorCode.DOMAIN_RULE_VIOLATION,
      httpStatus: 422,
      ...(context ? { context } : {}),
    });
  }
}

/** Un agregado no pudo mantener su invariante. Suele indicar un bug. */
export class InvariantViolationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super({
      message,
      code: ErrorCode.INVARIANT_VIOLATION,
      httpStatus: 500,
      operational: false,
      ...(context ? { context } : {}),
    });
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: ErrorDetail[]) {
    super({
      message,
      code: ErrorCode.VALIDATION,
      httpStatus: 400,
      ...(details ? { details } : {}),
    });
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super({
      message: id ? `${resource} no encontrado: ${id}` : `${resource} no encontrado`,
      code: ErrorCode.NOT_FOUND,
      httpStatus: 404,
      context: { resource, ...(id ? { id } : {}) },
    });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super({
      message,
      code: ErrorCode.CONFLICT,
      httpStatus: 409,
      ...(context ? { context } : {}),
    });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "No autenticado") {
    super({ message, code: ErrorCode.UNAUTHORIZED, httpStatus: 401 });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "No autorizado") {
    super({ message, code: ErrorCode.FORBIDDEN, httpStatus: 403 });
  }
}

/**
 * Se pidió más deprisa de lo que se tolera.
 *
 * NO es un rechazo definitivo, y por eso lleva `retryAfterMs`: el mensaje no se
 * ha perdido, solo hay que volver a traerlo. Los proveedores de canal
 * reintentan ante un 429, así que devolver esto por un webhook aplaza el lote
 * en vez de tirarlo — que es la diferencia entre proteger el sistema y perder
 * la conversación de un cliente.
 */
export class RateLimitedError extends AppError {
  readonly retryAfterMs: number;

  constructor(scope: string, retryAfterMs: number) {
    super({
      message: "Demasiadas peticiones seguidas. Vuelve a intentarlo en unos segundos.",
      code: ErrorCode.RATE_LIMITED,
      httpStatus: 429,
      context: { scope, retryAfterMs },
    });
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Fallo de una dependencia externa (LLM, PropertyService, API de un canal).
 * El agente lo traduce a lenguaje natural sin inventar datos.
 */
export class UpstreamError extends AppError {
  constructor(
    provider: string,
    kind: "unavailable" | "timeout" | "invalid_response",
    cause?: unknown,
  ) {
    const codes = {
      unavailable: ErrorCode.UPSTREAM_UNAVAILABLE,
      timeout: ErrorCode.UPSTREAM_TIMEOUT,
      invalid_response: ErrorCode.UPSTREAM_INVALID_RESPONSE,
    } as const;
    super({
      message: `Fallo del proveedor "${provider}" (${kind})`,
      code: codes[kind],
      httpStatus: 502,
      context: { provider, kind },
      cause,
    });
  }
}

export class InternalError extends AppError {
  constructor(message = "Error interno", cause?: unknown) {
    super({ message, code: ErrorCode.INTERNAL, httpStatus: 500, operational: false, cause });
  }
}

/** Normaliza cualquier `unknown` capturado a un AppError. */
export const toAppError = (cause: unknown): AppError => {
  if (cause instanceof AppError) return cause;
  if (cause instanceof Error) return new InternalError(cause.message, cause);
  return new InternalError("Error desconocido", cause);
};

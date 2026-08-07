import { AsyncLocalStorage } from "node:async_hooks";
import { AppError } from "../errors/app-error";
import { ErrorCode } from "../errors/error-codes";

/**
 * Contexto de ejecución de una unidad de trabajo (request HTTP, webhook, job).
 *
 * Se propaga por AsyncLocalStorage en lugar de pasarse a mano por 12 firmas de
 * función. El repositorio base y el logger lo leen de aquí, de modo que
 * *olvidar* el tenantId deja de ser posible: si no hay contexto, la operación
 * falla en vez de leer datos de todos los tenants.
 */
export interface ExecutionContext {
  readonly tenantId: string;
  /** Traza una conversación completa a través de webhook → job → agente → canal. */
  readonly correlationId: string;
  readonly userId?: string;
  readonly conversationId?: string;
  /** Origen de la ejecución, para métricas y auditoría. */
  readonly source: "http" | "webhook" | "job" | "cli" | "test";
}

const storage = new AsyncLocalStorage<ExecutionContext>();

export const TenantContext = {
  /** Ejecuta `fn` con el contexto dado. Todo lo que ocurra dentro lo verá. */
  run<T>(context: ExecutionContext, fn: () => T): T {
    return storage.run(context, fn);
  },

  /** Contexto actual o `undefined`. Úsalo solo cuando la ausencia sea válida. */
  peek(): ExecutionContext | undefined {
    return storage.getStore();
  },

  /** Contexto actual o error. Es lo que usan los repositorios. */
  require(): ExecutionContext {
    const context = storage.getStore();
    if (!context) {
      throw new AppError({
        message:
          "Se intentó una operación con ámbito de tenant fuera de un ExecutionContext. " +
          "Envuélvela en TenantContext.run().",
        code: ErrorCode.TENANT_CONTEXT_MISSING,
        httpStatus: 500,
        operational: false,
      });
    }
    return context;
  },

  requireTenantId(): string {
    return TenantContext.require().tenantId;
  },

  /** Deriva un contexto hijo (p. ej. al encolar un job desde un request). */
  derive(patch: Partial<ExecutionContext>): ExecutionContext {
    return { ...TenantContext.require(), ...patch };
  },

  /*
   * NO existe un `enterWith`. Se probó y no funciona donde haría falta: desde
   * un hook `async` de Fastify, el store no llega al handler, porque cuando la
   * promesa del hook se resuelve la cadena continúa en un contexto asíncrono
   * capturado ANTES de que el hook corriera.
   *
   * El patrón correcto en HTTP es un hook de estilo callback que envuelva su
   * `done()` con `run()` — así todo el ciclo de vida de la petición ocurre
   * dentro del ámbito. Está implementado en `identity/interface/http`.
   */
} as const;

/**
 * Verificación explícita de pertenencia. Se usa al recibir un id por parámetro
 * antes de operar sobre él: defensa contra IDOR entre inmobiliarias.
 */
export const assertSameTenant = (resourceTenantId: string, resourceLabel: string): void => {
  const current = TenantContext.requireTenantId();
  if (resourceTenantId !== current) {
    throw new AppError({
      message: `El recurso "${resourceLabel}" pertenece a otro tenant`,
      code: ErrorCode.TENANT_MISMATCH,
      httpStatus: 404, // 404, no 403: no revelamos la existencia del recurso.
      context: { resourceLabel, expected: current, actual: resourceTenantId },
    });
  }
};

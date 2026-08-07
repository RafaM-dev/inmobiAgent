import type { FastifyReply, FastifyRequest } from "fastify";
import { ForbiddenError, UnauthorizedError } from "../../../../platform/errors/app-error";
import { sessionCookieName } from "../../../../platform/http/session-cookie";
import { isErr } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import type { AuthenticatedUser, SessionService } from "../../application/ports/session-service";
import type { UserRole } from "../../domain/entities/user";

declare module "fastify" {
  interface FastifyRequest {
    /** Quién hizo la petición. Solo en rutas protegidas. */
    user?: AuthenticatedUser;
  }
}

/**
 * GUARDIA de las rutas del back-office.
 *
 * Hace dos cosas, y la segunda es la que sostiene el aislamiento entre
 * inmobiliarias: valida la sesión y **fija el `TenantContext` a partir de
 * ella**. Desde ese momento, cualquier repositorio que toque el handler ya está
 * acotado al tenant del asesor sin que el handler tenga que acordarse de nada.
 *
 * No existe forma de que una petición declare a qué inmobiliaria pertenece: no
 * se lee de un parámetro, ni de una cabecera, ni del cuerpo. Solo de la cookie,
 * que el navegador no deja tocar a nadie.
 */
export const requireSession =
  (deps: { sessions: SessionService; isProduction: boolean }) =>
  (request: FastifyRequest, _reply: FastifyReply, done: (error?: Error) => void): void => {
    const token = request.cookies[sessionCookieName(deps.isProduction)] ?? "";

    void deps.sessions.authenticate(token).then(
      (authenticated) => {
        if (isErr(authenticated)) {
          done(new UnauthorizedError("Sesión no válida o caducada"));
          return;
        }

        request.user = authenticated.value;

        /*
         * El hook es de ESTILO CALLBACK y no `async` a propósito.
         *
         * `AsyncLocalStorage.enterWith()` desde un hook asíncrono NO llega al
         * handler: cuando la promesa del hook se resuelve, Fastify continúa la
         * cadena en un contexto asíncrono capturado ANTES de que el hook
         * corriera, así que el store se pierde. Se descubrió con un
         * `TENANT_CONTEXT_MISSING` en la primera petición real.
         *
         * Envolviendo `done()` en `run()`, el resto del ciclo de vida de la
         * petición —handlers incluidos— ocurre DENTRO del ámbito, que es lo
         * que hace que los repositorios encuentren el tenant.
         */
        TenantContext.run(
          {
            tenantId: authenticated.value.tenantId,
            correlationId: request.correlationId,
            userId: authenticated.value.userId,
            source: "http",
          },
          () => {
            done();
          },
        );
      },
      (error: unknown) => {
        done(error instanceof Error ? error : new UnauthorizedError("Sesión no válida"));
      },
    );
  };

/** Usuario de la petición, o error si la ruta no estaba protegida. */
export const currentUser = (request: FastifyRequest): AuthenticatedUser => {
  if (!request.user) throw new UnauthorizedError("Esta ruta requiere sesión");
  return request.user;
};

/**
 * GUARDIA de rol. Se encadena DESPUÉS de `requireSession`.
 *
 * Separado del guardia de sesión a propósito: autenticar ("quién eres") y
 * autorizar ("qué puedes hacer") cambian por motivos distintos. Un rol nuevo
 * toca esta lista; nunca la validación de la cookie.
 *
 * El navegador también sabe quién puede editar —lo dice `canEdit` en las
 * respuestas— pero eso es solo para no pintar botones inútiles. La decisión
 * real se toma aquí, porque el navegador no es una frontera de seguridad.
 */
export const requireRole =
  (...allowed: readonly UserRole[]) =>
  (request: FastifyRequest, _reply: FastifyReply, done: (error?: Error) => void): void => {
    const user = request.user;
    if (!user) {
      done(new UnauthorizedError("Esta ruta requiere sesión"));
      return;
    }
    if (!allowed.includes(user.role)) {
      done(new ForbiddenError("Tu rol no permite esta operación"));
      return;
    }
    done();
  };

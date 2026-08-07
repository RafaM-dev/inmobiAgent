import { loginRequestSchema, type SessionResponse } from "@agentinmobi/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ValidationError } from "../../../../platform/errors/app-error";
import {
  sessionCookieName,
  sessionCookieOptions,
} from "../../../../platform/http/session-cookie";
import { currentUser } from "./session.guard";
import { isErr } from "../../../../platform/result/result";
import type { TenantDirectory } from "../../application/ports/tenant-directory";
import type { SessionService } from "../../application/ports/session-service";

export interface AuthRoutesDeps {
  sessions: SessionService;
  tenants: TenantDirectory;
  isProduction: boolean;
  requireSession: (
    request: FastifyRequest,
    reply: FastifyReply,
    done: (error?: Error) => void,
  ) => void;
}

/**
 * Acceso al back-office.
 *
 * Tres rutas y ninguna sorpresa: entrar, salir y saber quién soy. La tercera es
 * la que permite que la aplicación web sepa al arrancar si hay sesión sin
 * guardar nada en `localStorage` —donde cualquier XSS lo leería—.
 */
export const registerAuthRoutes = (app: FastifyInstance, deps: AuthRoutesDeps): void => {
  const cookieName = sessionCookieName(deps.isProduction);

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(
        "Datos de acceso inválidos",
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    }

    const result = await deps.sessions.login({
      tenantSlug: parsed.data.tenantSlug,
      email: parsed.data.email,
      password: parsed.data.password,
      ...(request.headers["user-agent"] !== undefined
        ? { userAgent: request.headers["user-agent"].slice(0, 300) }
        : {}),
      ...(request.ip ? { ipAddress: request.ip } : {}),
    });

    if (isErr(result)) throw result.error;

    // El token va a la cookie y NO al cuerpo: así no queda en el historial de
    // red del navegador ni en un log de la aplicación web.
    void reply.setCookie(
      cookieName,
      result.value.token,
      sessionCookieOptions(deps.isProduction, result.value.expiresAt),
    );

    const body: SessionResponse = {
      user: result.value.user,
      tenantSlug: result.value.tenantSlug,
      tenantName: result.value.tenantName,
      expiresAt: result.value.expiresAt.toISOString(),
    };

    return reply.status(200).send(body);
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[cookieName];
    if (token) await deps.sessions.logout(token);

    // Se borra siempre, haya sesión o no: salir tiene que dejar el navegador
    // limpio aunque la sesión ya hubiera caducado.
    void reply.clearCookie(cookieName, sessionCookieOptions(deps.isProduction));
    return reply.status(204).send();
  });

  app.get(
    "/api/auth/me",
    { preHandler: deps.requireSession },
    async (request, reply) => {
      const user = currentUser(request);
      const tenant = await deps.tenants.requireActive(user.tenantId);

      const body: SessionResponse = {
        user,
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
      };

      return reply.status(200).send(body);
    },
  );
};

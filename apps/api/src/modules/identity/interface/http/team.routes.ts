import {
  inviteUserRequestSchema,
  updateTeamMemberRequestSchema,
  type InviteUserResponse,
  type TeamListResponse,
} from "@agentinmobi/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ValidationError } from "../../../../platform/errors/app-error";
import { isErr } from "../../../../platform/result/result";
import type {
  InviteUserUseCase,
  ListTeamUseCase,
  TeamMemberView,
  UpdateTeamMemberUseCase,
} from "../../application/use-cases/manage-users.use-cases";
import { UserRole } from "../../domain/entities/user";
import { currentUser } from "./session.guard";

type Guard = (request: FastifyRequest, reply: FastifyReply, done: (error?: Error) => void) => void;

export interface TeamRoutesDeps {
  listTeam: ListTeamUseCase;
  inviteUser: InviteUserUseCase;
  updateMember: UpdateTeamMemberUseCase;
  requireSession: Guard;
  requireAdmin: Guard;
}

/** Quién puede tocar el equipo. Lo mismo que decide la configuración del agente. */
const MANAGERS: readonly UserRole[] = [UserRole.OWNER, UserRole.ADMIN];

const toContract = (member: TeamMemberView) => ({
  id: member.id,
  email: member.email,
  displayName: member.displayName,
  role: member.role,
  status: member.status,
  createdAt: member.createdAt.toISOString(),
});

/**
 * El equipo de la inmobiliaria.
 *
 * Todo el mundo con sesión puede VER quién está —hace falta para saber a quién
 * asignar un lead—, pero solo propietario y administradores pueden invitar,
 * cambiar roles o dar de baja. La lectura y la escritura se separan aquí y se
 * vuelven a comprobar en el caso de uso: el navegador no es una frontera de
 * seguridad, solo evita pintar botones inútiles.
 */
export const registerTeamRoutes = (app: FastifyInstance, deps: TeamRoutesDeps): void => {
  app.get("/api/users", { preHandler: deps.requireSession }, async (request, reply) => {
    const user = currentUser(request);
    const result = await deps.listTeam.execute();
    if (isErr(result)) throw result.error;

    const body: TeamListResponse = {
      items: result.value.map(toContract),
      canManage: MANAGERS.includes(user.role),
    };
    return reply.send(body);
  });

  app.post(
    "/api/users",
    { preHandler: [deps.requireSession, deps.requireAdmin] },
    async (request, reply) => {
      const parsed = inviteUserRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(
          "Datos de la invitación inválidos",
          parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        );
      }

      const actor = currentUser(request);
      const result = await deps.inviteUser.execute({
        ...parsed.data,
        actor: { userId: actor.userId, role: actor.role, displayName: actor.displayName },
      });
      if (isErr(result)) throw result.error;

      const body: InviteUserResponse = {
        user: toContract(result.value.user),
        delivered: result.value.delivered,
        ...(result.value.url !== undefined ? { url: result.value.url } : {}),
      };

      // 201 aunque el correo no haya salido: la invitación EXISTE y el enlace
      // es válido. Que el envío fallara se dice en `delivered`, no en el estado.
      return reply.status(201).send(body);
    },
  );

  app.patch<{ Params: { userId: string } }>(
    "/api/users/:userId",
    { preHandler: [deps.requireSession, deps.requireAdmin] },
    async (request, reply) => {
      const parsed = updateTeamMemberRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError("Cambio inválido");
      }
      if (parsed.data.role === undefined && parsed.data.status === undefined) {
        throw new ValidationError("No hay nada que cambiar");
      }

      const actor = currentUser(request);
      const result = await deps.updateMember.execute({
        userId: request.params.userId,
        role: parsed.data.role,
        status: parsed.data.status,
        actor: { userId: actor.userId, role: actor.role },
      });
      if (isErr(result)) throw result.error;

      return reply.send(toContract(result.value));
    },
  );
};

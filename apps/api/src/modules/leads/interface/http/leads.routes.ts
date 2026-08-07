import { leadListQuerySchema, type LeadListResponse } from "@agentinmobi/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ValidationError } from "../../../../platform/errors/app-error";
import { isErr } from "../../../../platform/result/result";
import { currentUser } from "../../../identity";
import type { ListLeadsUseCase } from "../../application/use-cases/list-leads.use-case";

export interface LeadsRoutesDeps {
  listLeads: ListLeadsUseCase;
  requireSession: (
    request: FastifyRequest,
    reply: FastifyReply,
    done: (error?: Error) => void,
  ) => void;
}

/**
 * Bandeja de leads.
 *
 * Ordenada por puntuación descendente desde el repositorio: lo primero que ve
 * un asesor al abrir la pantalla es a quién llamar ahora, no quién entró más
 * recientemente.
 */
export const registerLeadsRoutes = (app: FastifyInstance, deps: LeadsRoutesDeps): void => {
  app.get("/api/leads", { preHandler: deps.requireSession }, async (request, reply) => {
    const query = leadListQuerySchema.safeParse(request.query);
    if (!query.success) throw new ValidationError("Filtros de leads inválidos");

    const user = currentUser(request);
    const result = await deps.listLeads.execute({
      ...(query.data.status ? { status: query.data.status } : {}),
      ...(query.data.band ? { band: query.data.band } : {}),
      ...(query.data.mine === true ? { assignedUserId: user.userId } : {}),
      limit: query.data.limit,
      offset: query.data.offset,
    });

    if (isErr(result)) throw result.error;

    const body: LeadListResponse = {
      items: result.value.map((lead) => ({
        id: lead.id,
        contactId: lead.contactId,
        conversationId: lead.conversationId,
        status: lead.status,
        score: lead.score,
        band: lead.band,
        ...(lead.assignedUserId !== undefined ? { assignedUserId: lead.assignedUserId } : {}),
        interestCount: lead.interestCount,
        lastActivityAt: lead.lastActivityAt.toISOString(),
      })),
    };

    return reply.send(body);
  });
};

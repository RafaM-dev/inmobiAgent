import {
  assignLeadSchema,
  changeLeadStatusSchema,
  leadListQuerySchema,
  type LeadListResponse,
  type LeadSummaryContract,
} from "@agentinmobi/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ValidationError } from "../../../../platform/errors/app-error";
import { isErr } from "../../../../platform/result/result";
import { currentUser } from "../../../identity";
import { allowedTransitions } from "../../domain/entities/lead";
import type { LeadSummary } from "../../domain/repositories/lead.repository";
import type {
  AssignLeadUseCase,
  ChangeLeadStatusUseCase,
} from "../../application/use-cases/manage-lead.use-cases";
import type { ListLeadsUseCase } from "../../application/use-cases/list-leads.use-case";

export interface LeadsRoutesDeps {
  listLeads: ListLeadsUseCase;
  changeLeadStatus: ChangeLeadStatusUseCase;
  assignLead: AssignLeadUseCase;
  requireSession: (
    request: FastifyRequest,
    reply: FastifyReply,
    done: (error?: Error) => void,
  ) => void;
}

/**
 * Las transiciones posibles se calculan aquí, en el borde, y no en la consulta:
 * son una función pura del estado, así que sacarlas de la base sería pedirle a
 * SQL que conozca el embudo. Que salgan del agregado significa que cambiar la
 * tabla de transiciones actualiza el panel sin tocar el panel.
 */
const toContract = (lead: LeadSummary): LeadSummaryContract => ({
  id: lead.id,
  contactId: lead.contactId,
  conversationId: lead.conversationId,
  status: lead.status,
  score: lead.score,
  band: lead.band,
  ...(lead.assignedUserId !== undefined ? { assignedUserId: lead.assignedUserId } : {}),
  interestCount: lead.interestCount,
  lastActivityAt: lead.lastActivityAt.toISOString(),
  allowedTransitions: [...allowedTransitions(lead.status)],
});

/**
 * Bandeja de leads.
 *
 * Ordenada por puntuación descendente desde el repositorio: lo primero que ve
 * un asesor al abrir la pantalla es a quién llamar ahora, no quién entró más
 * recientemente.
 *
 * **Quién puede mover un lead: cualquiera con sesión, y es deliberado.** En una
 * inmobiliaria pequeña el asesor que atiende la llamada es el que dice "lo tomo
 * yo" y el que marca "ganado" al firmar; exigir un administrador para eso
 * convertiría el embudo en papeleo, y un embudo que da pereza actualizar deja
 * de ser información. Los roles finos —que solo un jefe reasigne el lead de
 * otro— son una decisión de producto que se toma cuando alguien la pida, no un
 * descuido: `requireSession` ya garantiza que quien entra pertenece al tenant, y
 * el histórico deja escrito cada cambio con su autor.
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

    const body: LeadListResponse = { items: result.value.map(toContract) };
    return reply.send(body);
  });

  /**
   * Mover el lead por el embudo.
   *
   * `PATCH` y no `POST /transiciones`: desde fuera esto es modificar un campo de
   * un recurso que ya existe. Que por dentro sea una máquina de estados con
   * historial es asunto del agregado, no del que llama.
   */
  app.patch<{ Params: { leadId: string } }>(
    "/api/leads/:leadId/status",
    { preHandler: deps.requireSession },
    async (request, reply) => {
      const body = changeLeadStatusSchema.safeParse(request.body);
      if (!body.success) throw new ValidationError("Estado de lead inválido");

      const result = await deps.changeLeadStatus.execute({
        leadId: request.params.leadId,
        status: body.data.status,
        ...(body.data.reason !== undefined ? { reason: body.data.reason } : {}),
      });

      if (isErr(result)) throw result.error;
      return reply.send(toContract(result.value));
    },
  );

  app.patch<{ Params: { leadId: string } }>(
    "/api/leads/:leadId/assignment",
    { preHandler: deps.requireSession },
    async (request, reply) => {
      const body = assignLeadSchema.safeParse(request.body);
      if (!body.success) throw new ValidationError("Asignación de lead inválida");

      const result = await deps.assignLead.execute({
        leadId: request.params.leadId,
        userId: body.data.userId,
      });

      if (isErr(result)) throw result.error;
      return reply.send(toContract(result.value));
    },
  );
};

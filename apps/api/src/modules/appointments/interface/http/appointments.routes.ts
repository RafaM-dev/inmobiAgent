import {
  appointmentListQuerySchema,
  type AppointmentListResponse,
} from "@agentinmobi/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ValidationError } from "../../../../platform/errors/app-error";
import { isErr } from "../../../../platform/result/result";
import { currentUser } from "../../../identity";
import type { ListAppointmentsUseCase } from "../../application/use-cases/list-appointments.use-case";

export interface AppointmentsRoutesDeps {
  listAppointments: ListAppointmentsUseCase;
  requireSession: (
    request: FastifyRequest,
    reply: FastifyReply,
    done: (error?: Error) => void,
  ) => void;
}

/** Agenda de visitas del back-office. */
export const registerAppointmentsRoutes = (
  app: FastifyInstance,
  deps: AppointmentsRoutesDeps,
): void => {
  app.get("/api/appointments", { preHandler: deps.requireSession }, async (request, reply) => {
    const query = appointmentListQuerySchema.safeParse(request.query);
    if (!query.success) throw new ValidationError("Filtros de agenda inválidos");

    const user = currentUser(request);
    const result = await deps.listAppointments.execute({
      days: query.data.days,
      ...(query.data.mine === true ? { assignedUserId: user.userId } : {}),
    });

    if (isErr(result)) throw result.error;

    const body: AppointmentListResponse = {
      items: result.value.map(({ appointment, label }) => ({
        id: appointment.id,
        conversationId: appointment.conversationId,
        contactId: appointment.contactId,
        ...(appointment.leadId !== undefined ? { leadId: appointment.leadId } : {}),
        ...(appointment.propertyRef !== undefined
          ? { propertyRef: appointment.propertyRef }
          : {}),
        status: appointment.status,
        scheduledAt: appointment.scheduledAt.toISOString(),
        label,
        durationMin: appointment.durationMin,
        ...(appointment.assignedUserId !== undefined
          ? { assignedUserId: appointment.assignedUserId }
          : {}),
      })),
    };

    return reply.send(body);
  });
};

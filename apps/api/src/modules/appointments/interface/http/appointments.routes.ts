import {
  appointmentListQuerySchema,
  cancelAppointmentSchema,
  type AppointmentActionResponse,
  type AppointmentListResponse,
} from "@agentinmobi/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ValidationError } from "../../../../platform/errors/app-error";
import { isErr } from "../../../../platform/result/result";
import { currentUser } from "../../../identity";
import type { AppointmentView } from "../../application/ports/appointment-service";
import type {
  CancelAppointmentUseCase,
  ConfirmAppointmentUseCase,
} from "../../application/use-cases/manage-appointment.use-cases";
import type { ListAppointmentsUseCase } from "../../application/use-cases/list-appointments.use-case";

export interface AppointmentsRoutesDeps {
  listAppointments: ListAppointmentsUseCase;
  confirmAppointment: ConfirmAppointmentUseCase;
  cancelAppointment: CancelAppointmentUseCase;
  requireSession: (
    request: FastifyRequest,
    reply: FastifyReply,
    done: (error?: Error) => void,
  ) => void;
}

const toActionResponse = (view: AppointmentView): AppointmentActionResponse => ({
  id: view.id,
  status: view.status,
  scheduledAt: view.scheduledAt.toISOString(),
  label: view.label,
});

/**
 * Agenda de visitas del back-office.
 *
 * Confirmar y cancelar son `POST` a un sub-recurso y no un `PATCH` del estado.
 * Aquí sí es lo correcto, al revés que en los leads: no son un campo que se
 * escribe, son dos operaciones con efectos propios —cancelar publica un evento
 * que avisa al cliente por su canal— y con un vocabulario cerrado. Dejar que
 * alguien mande `status: "COMPLETED"` sería inventar una transición que el
 * agregado no ofrece.
 */
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

  app.post<{ Params: { appointmentId: string } }>(
    "/api/appointments/:appointmentId/confirm",
    { preHandler: deps.requireSession },
    async (request, reply) => {
      const result = await deps.confirmAppointment.execute(request.params.appointmentId);
      if (isErr(result)) throw result.error;
      return reply.send(toActionResponse(result.value));
    },
  );

  app.post<{ Params: { appointmentId: string } }>(
    "/api/appointments/:appointmentId/cancel",
    { preHandler: deps.requireSession },
    async (request, reply) => {
      // Cuerpo opcional: cancelar sin motivo es válido, y exigir `{}` para eso
      // sería una trampa para quien llame a mano.
      const body = cancelAppointmentSchema.safeParse(request.body ?? {});
      if (!body.success) throw new ValidationError("Motivo de cancelación inválido");

      const result = await deps.cancelAppointment.execute(
        request.params.appointmentId,
        body.data.reason,
      );
      if (isErr(result)) throw result.error;
      return reply.send(toActionResponse(result.value));
    },
  );
};

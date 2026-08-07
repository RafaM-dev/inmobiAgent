import { z } from "zod";
import { isErr } from "../../../../platform/result/result";
import type { AppointmentService } from "../../../appointments";
import { quickRepliesBlock, textBlock, type ReplyBlock } from "../../../channels";
import {
  toolError,
  toolOk,
  type AgentTool,
  type ToolContext,
  type ToolResult,
} from "../ports/agent-tool";

/* ========================================================================== *
 * Agendar una visita, en dos herramientas
 *
 * La separación no es cosmética: una PROPONE lo que existe y otra AGENDA lo que
 * el cliente eligió. El modelo nunca escribe una fecha —solo devuelve la
 * referencia opaca de una franja que nosotros le ofrecimos—, igual que nunca
 * escribe un precio. Un modelo que inventa "el jueves a las 3" manda a alguien
 * a una oficina cerrada, y eso no se arregla con un prompt mejor.
 * ========================================================================== */

/**
 * Día preferido en términos RELATIVOS. El modelo no traduce "mañana" a una
 * fecha: dice "mañana" y aquí se calcula. Una zona horaria mal aplicada por el
 * modelo sería un día entero de diferencia.
 */
const PreferredDay = {
  TODAY: "today",
  TOMORROW: "tomorrow",
  THIS_WEEK: "this_week",
  NEXT_WEEK: "next_week",
} as const;

export const proposeVisitSlotsSchema = z.object({
  preferredDay: z
    .enum([PreferredDay.TODAY, PreferredDay.TOMORROW, PreferredDay.THIS_WEEK, PreferredDay.NEXT_WEEK])
    .optional()
    .describe("Cuándo prefiere el cliente, si lo ha dicho. No escribas fechas."),
  propertyRef: z
    .string()
    .max(120)
    .optional()
    .describe("Referencia del inmueble a visitar, tal como aparece en la búsqueda"),
});

export type ProposeVisitSlotsArgs = z.infer<typeof proposeVisitSlotsSchema>;

export interface ProposeVisitSlotsToolResult {
  readonly count: number;
  /** Franjas ofrecidas: referencia opaca y texto ya escrito. */
  readonly slots: readonly { reference: string; label: string }[];
}

/**
 * Frase con la que se ofrecen los horarios. Es una constante y no un literal
 * suelto porque el simulador de IA la usa para reconocer, en el turno
 * siguiente, que las opciones que el cliente está eligiendo son las suyas. Un
 * modelo real no la necesita: entiende el historial y ya está.
 */
export const SLOT_OFFER_PROMPT = "¿Cuál de estos horarios te queda mejor?";

const DAY_OFFSET: Record<string, number> = {
  [PreferredDay.TODAY]: 0,
  [PreferredDay.TOMORROW]: 1,
  [PreferredDay.THIS_WEEK]: 0,
  [PreferredDay.NEXT_WEEK]: 7,
};

export const createProposeVisitSlotsTool = (deps: {
  appointments: AppointmentService;
  clock: { now(): Date };
}): AgentTool<ProposeVisitSlotsArgs, ProposeVisitSlotsToolResult> => ({
  name: "propose_visit_slots",
  description:
    "Consulta qué horarios hay libres para visitar un inmueble. Úsala en cuanto el cliente " +
    "hable de ver algo, visitar o agendar. Devuelve las franjas ya escritas: no inventes ni " +
    "reescribas fechas ni horas, preséntale al cliente las que te devuelva.",
  parameters: proposeVisitSlotsSchema,
  sideEffect: "none",

  async execute(
    args: ProposeVisitSlotsArgs,
    context: ToolContext,
  ): Promise<ToolResult<ProposeVisitSlotsToolResult>> {
    const preferredDate =
      args.preferredDay !== undefined
        ? new Date(
            deps.clock.now().getTime() + (DAY_OFFSET[args.preferredDay] ?? 0) * 86_400_000,
          )
        : undefined;

    const proposed = await deps.appointments.proposeSlots({
      conversationId: context.conversationId,
      ...(preferredDate ? { preferredDate } : {}),
    });

    if (isErr(proposed)) {
      return toolError(
        "AGENDA_UNAVAILABLE",
        "No pude consultar la agenda. No inventes horarios: dilo y ofrece que un asesor lo coordine.",
        true,
      );
    }

    const slots = proposed.value.slots;

    if (slots.length === 0) {
      return toolOk(
        { count: 0, slots: [] },
        "Sin franjas disponibles en los próximos días",
      );
    }

    // Los horarios viajan como botones construidos aquí. El canal que no los
    // soporte los verá como lista numerada, y el modelo no se entera.
    const blocks: ReplyBlock[] = [
      quickRepliesBlock(
        SLOT_OFFER_PROMPT,
        slots.map((slot) => ({ label: slot.label, value: slot.reference })),
      ),
    ];

    return toolOk(
      {
        count: slots.length,
        slots: slots.map((slot) => ({ reference: slot.reference, label: slot.label })),
      },
      `${String(slots.length)} horarios disponibles`,
      blocks,
    );
  },
});

/* -------------------------------------------------------------------------- */

export const scheduleVisitSchema = z.object({
  slotReference: z
    .string()
    .min(4)
    .max(200)
    .describe("Referencia EXACTA de la franja que eligió el cliente, de propose_visit_slots"),
  propertyRef: z.string().max(120).optional().describe("Referencia del inmueble a visitar"),
  notes: z.string().max(300).optional().describe("Algo que el asesor deba saber"),
});

export type ScheduleVisitArgs = z.infer<typeof scheduleVisitSchema>;

export interface ScheduleVisitToolResult {
  readonly appointmentId: string;
  readonly status: string;
  readonly label: string;
  readonly rescheduled: boolean;
}

export const createScheduleVisitTool = (deps: {
  appointments: AppointmentService;
}): AgentTool<ScheduleVisitArgs, ScheduleVisitToolResult> => ({
  name: "schedule_visit",
  description:
    "Agenda la visita en la franja que el cliente eligió. Pasa la referencia EXACTA que te " +
    "devolvió propose_visit_slots; nunca una fecha escrita por ti. Si el cliente ya tenía una " +
    "visita, esta llamada la mueve a la nueva hora.",
  parameters: scheduleVisitSchema,
  sideEffect: "write",

  async execute(
    args: ScheduleVisitArgs,
    context: ToolContext,
  ): Promise<ToolResult<ScheduleVisitToolResult>> {
    const scheduled = await deps.appointments.request({
      conversationId: context.conversationId,
      contactId: context.contactId,
      slotReference: args.slotReference,
      ...(args.propertyRef !== undefined ? { propertyRef: args.propertyRef } : {}),
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
    });

    if (isErr(scheduled)) {
      // El motivo se le devuelve al modelo tal cual para que lo explique y
      // vuelva a proponer, en vez de dar por hecha una cita que no existe.
      return toolError("SLOT_NOT_AVAILABLE", scheduled.error.message, true);
    }

    const appointment = scheduled.value;

    // La confirmación con la hora la escribe la herramienta, no el modelo.
    // Sin punto tras la etiqueta: en es-CO ya termina en "a. m.".
    const blocks: ReplyBlock[] = [
      textBlock(
        appointment.rescheduled
          ? `Listo, moví tu visita: ${appointment.label}`
          : `Tu visita quedó agendada: ${appointment.label}`,
      ),
    ];

    return toolOk(
      {
        appointmentId: appointment.id,
        status: appointment.status,
        label: appointment.label,
        rescheduled: appointment.rescheduled,
      },
      appointment.rescheduled ? "Visita reprogramada" : "Visita agendada",
      blocks,
    );
  },
});

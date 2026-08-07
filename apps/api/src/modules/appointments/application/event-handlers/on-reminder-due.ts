import { subscription, type EventSubscription } from "../../../../platform/events/event";
import type { Logger } from "../../../../platform/logging/logger";
import { isErr } from "../../../../platform/result/result";
import { textBlock } from "../../../channels";
import { MessageAuthorType, type ConversationService } from "../../../conversation";
import type { TenantDirectory } from "../../../identity";
import { formatSlot } from "../mappers/slot-label.mapper";
import {
  AppointmentReminderDue,
  type AppointmentReminderDuePayload,
} from "../events/appointments.events";
import { resolveScheduling, SCHEDULING } from "../services/scheduling-settings";

/**
 * `appointment.reminder_due` → mensaje al cliente por su propio canal.
 *
 * Se envía como `SYSTEM`, no como el agente: no es una respuesta a nada que el
 * cliente haya escrito, y por eso llega igual aunque un asesor humano tenga
 * tomada la conversación. Un recordatorio que se calla porque el bot está en
 * pausa es un cliente que no aparece a la visita.
 *
 * El texto de la hora lo escribe el formateador, nunca el modelo (§7.3, paso 5).
 */
export const onReminderDue = (deps: {
  conversations: ConversationService;
  tenants: TenantDirectory;
  logger: Logger;
}): EventSubscription =>
  subscription<AppointmentReminderDuePayload>(
    "appointments.on-reminder-due",
    AppointmentReminderDue,
    async (envelope) => {
      const settings = await resolveScheduling(deps.tenants);
      const label = formatSlot(
        { startsAt: new Date(envelope.payload.scheduledAt), durationMin: SCHEDULING.durationMin },
        settings.timezone,
        settings.locale,
      );

      const delivered = await deps.conversations.reply({
        conversationId: envelope.payload.conversationId,
        blocks: [
          // La etiqueta va al final de su cláusula y sin punto detrás: en
          // es-CO termina en "a. m.", y añadir otro punto deja "a. m..".
          textBlock(
            `Te recuerdo tu visita: ${label} — si necesitas moverla o cancelarla, dímelo por aquí.`,
          ),
        ],
        authorType: MessageAuthorType.SYSTEM,
      });

      if (isErr(delivered)) {
        deps.logger.warn("No se pudo enviar el recordatorio de la visita", {
          appointmentId: envelope.payload.appointmentId,
          errorCode: delivered.error.code,
        });
      }
    },
  ) as EventSubscription;

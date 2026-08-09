import { subscription, type EventSubscription } from "../../../../platform/events/event";
import type { Logger } from "../../../../platform/logging/logger";
import type { Notifier } from "../../../../platform/notifications/notifier";
import { isErr } from "../../../../platform/result/result";
import type { ConversationService } from "../../../conversation";
import type { TenantDirectory } from "../../../identity";
import { HandoffRequested, type HandoffRequestedPayload } from "../events/agent.events";

/**
 * `agent.handoff_requested` → aviso a la inmobiliaria.
 *
 * Esto faltaba, y era el peor hueco del producto: el agente escalaba
 * correctamente, el bot se callaba, el cliente leía «te paso con un asesor»…
 * y nadie se enteraba. La conversación se quedaba muerta hasta que alguien
 * abriera el inbox por casualidad. Se pierde justo al cliente más interesado.
 *
 * Va por evento y no dentro del escalado a propósito. `HandoffCoordinator`
 * silencia el bot y responde al cliente en el mismo turno: meter ahí un SMTP
 * que puede tardar cinco segundos o estar caído retrasaría —o impediría— la
 * respuesta al cliente por un correo que a él no le importa. Aquí el aviso sale
 * del outbox, con reintentos y `dead-letter`, sin tocar el camino crítico.
 */
export const onHandoffRequested = (deps: {
  tenants: TenantDirectory;
  conversations: ConversationService;
  notifier: Notifier;
  backofficeUrl: string;
  logger: Logger;
}): EventSubscription =>
  subscription<HandoffRequestedPayload>(
    "agent.on-handoff-requested",
    HandoffRequested,
    async (envelope) => {
      const { conversationId, reason, note } = envelope.payload;

      const tenant = await deps.tenants.findById(envelope.tenantId);
      const to = tenant?.settings.handoffEmail;

      if (tenant === null || to === undefined) {
        /*
         * Sin correo configurado no hay nada que hacer, y NO es un error: una
         * inmobiliaria pequeña puede vivir mirando el inbox. Se registra en
         * `info` para que se vea en el log por defecto, porque la diferencia
         * entre «no está configurado» y «no funciona» tiene que ser evidente
         * el día que alguien pregunte por qué no le llegan avisos.
         */
        deps.logger.info("Escalado sin aviso: la inmobiliaria no tiene correo configurado", {
          conversationId,
          reason,
        });
        return;
      }

      const context = await deps.conversations.getContext(conversationId);
      const contactName = isErr(context) ? "Un cliente" : context.value.contactName;
      const lastFromContact = isErr(context)
        ? undefined
        : [...context.value.messages].reverse().find((message) => message.role === "contact")?.text;

      const sent = await deps.notifier.send({
        to,
        subject: `[${tenant.name}] ${contactName} necesita a una persona`,
        body: compose({
          tenantName: tenant.name,
          contactName,
          reason,
          note,
          lastFromContact,
          url: `${deps.backofficeUrl}/inbox/${conversationId}`,
        }),
      });

      if (isErr(sent)) {
        /*
         * Se RELANZA, al revés que en casi todos los demás handlers. Que no se
         * pueda anotar un interés en el CRM se puede perder; que nadie atienda
         * a un cliente que pidió hablar con una persona, no. Al lanzar, el
         * outbox reintenta con backoff y acaba en `dead-letter` con su motivo
         * si el correo sigue sin salir.
         */
        throw new Error(`No se pudo avisar del escalado: ${sent.error.code}`);
      }

      deps.logger.info("Escalado avisado", { conversationId, reason, channel: deps.notifier.channel });
    },
  ) as EventSubscription;

/** Por qué se escaló, en el idioma en el que se lo contarías a un compañero. */
const REASON_TEXT: Record<string, string> = {
  USER_REQUEST: "lo ha pedido expresamente",
  OUT_OF_SCOPE: "ha preguntado algo fuera del alcance del agente",
  REPEATED_FAILURE: "el agente lleva varios intentos sin resolverle",
  TOOL_FAILURE: "ha fallado una consulta que el agente necesitaba",
  PROVIDER_FAILURE: "un servicio externo no responde",
  BUDGET_EXHAUSTED: "se ha agotado el presupuesto de IA del mes",
  GUARDRAIL: "el agente iba a decir algo que no podía justificar con datos",
  BUSINESS_RULE: "una regla de la inmobiliaria pide que lo lleve una persona",
};

/**
 * El cuerpo del aviso.
 *
 * Se lee en el móvil, de pie, entre dos visitas. Por eso lleva el motivo y lo
 * último que dijo el cliente: con eso se decide si se llama ahora o en una hora
 * SIN abrir el panel. El enlace está para actuar, no para enterarse.
 */
const compose = (input: {
  tenantName: string;
  contactName: string;
  reason: string;
  /** Siempre se pasan; que falten es información, no ausencia de argumento. */
  note: string | undefined;
  lastFromContact: string | undefined;
  url: string;
}): string => {
  const lines = [
    `${input.contactName} está esperando a una persona en ${input.tenantName}.`,
    "",
    `Motivo: ${REASON_TEXT[input.reason] ?? input.reason}.`,
  ];

  if (input.note !== undefined && input.note.trim().length > 0) {
    lines.push(`Nota del agente: ${input.note.trim()}`);
  }

  if (input.lastFromContact !== undefined && input.lastFromContact.trim().length > 0) {
    lines.push("", "Lo último que escribió:", `  «${truncate(input.lastFromContact.trim(), 300)}»`);
  }

  lines.push(
    "",
    "El bot ya está en silencio en esa conversación: no va a responder hasta que alguien la suelte.",
    "",
    `Abrir la conversación: ${input.url}`,
  );

  return lines.join("\n");
};

/** Un correo no es un volcado del hilo. Si hace falta más, está el enlace. */
const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

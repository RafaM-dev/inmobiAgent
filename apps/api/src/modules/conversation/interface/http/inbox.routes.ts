import {
  inboxListQuerySchema,
  sendMessageRequestSchema,
  takeoverRequestSchema,
  type ConversationDetail,
  type InboxListResponse,
  type ReplyBlockContract,
} from "@agentinmobi/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ValidationError } from "../../../../platform/errors/app-error";
import type { Logger } from "../../../../platform/logging/logger";
import { isErr } from "../../../../platform/result/result";
import { currentUser } from "../../../identity";
import type { ReplyBlock } from "../../../channels";
import type { InboxStreamHub } from "../../application/ports/inbox-stream";
import type { GetConversationThreadUseCase } from "../../application/use-cases/get-conversation-thread.use-case";
import type { ListInboxUseCase } from "../../application/use-cases/list-inbox.use-case";
import type { SendHumanMessageUseCase } from "../../application/use-cases/send-human-message.use-case";
import type { SetConversationControlUseCase } from "../../application/use-cases/set-conversation-control.use-case";

/**
 * Comprobación en tiempo de compilación de que TODOS los tipos de bloque del
 * dominio están publicados en el contrato.
 *
 * Si alguien añade un `kind` en `channels` y se olvida de publicarlo, esto deja
 * de compilar en vez de romper el navegador en producción con un bloque que no
 * sabe pintar. Se comparan los `kind` y no las formas completas a propósito:
 * el dominio usa arrays de solo lectura y el contrato no, y esa diferencia de
 * varianza no dice nada sobre si el contrato está al día.
 */
type BlockKindsPublished = ReplyBlock["kind"] extends ReplyBlockContract["kind"] ? true : never;
const _blockKindsPublished: BlockKindsPublished = true;

export interface InboxRoutesDeps {
  listInbox: ListInboxUseCase;
  getThread: GetConversationThreadUseCase;
  sendHumanMessage: SendHumanMessageUseCase;
  setControl: SetConversationControlUseCase;
  stream: InboxStreamHub;
  requireSession: (
    request: FastifyRequest,
    reply: FastifyReply,
    done: (error?: Error) => void,
  ) => void;
  logger: Logger;
}

interface ConversationParams {
  conversationId: string;
}

/**
 * Bandeja del back-office.
 *
 * Todas las rutas pasan por el guardia de sesión, que además de autenticar fija
 * el `TenantContext`. Por eso ninguna recibe el tenant: no hay dónde ponerlo.
 */
export const registerInboxRoutes = (app: FastifyInstance, deps: InboxRoutesDeps): void => {
  const auth = { preHandler: deps.requireSession };

  app.get("/api/inbox", auth, async (request, reply) => {
    const query = inboxListQuerySchema.safeParse(request.query);
    if (!query.success) throw new ValidationError("Filtros de bandeja inválidos");

    const user = currentUser(request);
    const result = await deps.listInbox.execute({
      ...(query.data.status ? { status: query.data.status } : {}),
      ...(query.data.mine === true ? { assignedUserId: user.userId } : {}),
      limit: query.data.limit,
      offset: query.data.offset,
    });

    if (isErr(result)) throw result.error;

    const body: InboxListResponse = {
      total: result.value.total,
      items: result.value.items.map((entry) => ({
        conversationId: entry.conversationId,
        contactId: entry.contactId,
        contactName: entry.contactName,
        channelType: entry.channelType,
        status: entry.status,
        stage: entry.stage,
        ...(entry.assignedUserId !== undefined ? { assignedUserId: entry.assignedUserId } : {}),
        lastMessagePreview: entry.lastMessagePreview,
        lastMessageAt: entry.lastMessageAt.toISOString(),
        lastMessageFrom: entry.lastMessageFrom as InboxListResponse["items"][number]["lastMessageFrom"],
        messageCount: entry.messageCount,
      })),
    };

    return reply.send(body);
  });

  app.get<{ Params: ConversationParams }>(
    "/api/inbox/:conversationId",
    auth,
    async (request, reply) => {
      const thread = await deps.getThread.execute(request.params.conversationId);
      if (isErr(thread)) throw thread.error;

      const body: ConversationDetail = {
        conversationId: thread.value.conversationId,
        contactId: thread.value.contactId,
        contactName: thread.value.contactName,
        channelType: thread.value.channelType,
        status: thread.value.status,
        stage: thread.value.stage,
        ...(thread.value.assignedUserId !== undefined
          ? { assignedUserId: thread.value.assignedUserId }
          : {}),
        messages: thread.value.messages.map((message) => ({
          id: message.id,
          author: message.author,
          direction: message.direction,
          blocks: message.blocks as ReplyBlockContract[],
          sentAt: message.sentAt.toISOString(),
        })),
        profile: [...thread.value.profile],
        missingRequiredSlots: [...thread.value.missingRequiredSlots],
      };

      return reply.send(body);
    },
  );

  /** El asesor toma la conversación: el bot deja de responder de inmediato. */
  app.post<{ Params: ConversationParams }>(
    "/api/inbox/:conversationId/takeover",
    auth,
    async (request, reply) => {
      const user = currentUser(request);
      takeoverRequestSchema.parse(request.body ?? {});

      const result = await deps.setControl.execute(request.params.conversationId, {
        action: "assign_human",
        userId: user.userId,
      });
      if (isErr(result)) throw result.error;

      deps.stream.publish(user.tenantId, {
        type: "conversation_changed",
        payload: { conversationId: request.params.conversationId, status: "HUMAN" },
      });

      return reply.status(204).send();
    },
  );

  /** Devuelve la conversación al bot. */
  app.post<{ Params: ConversationParams }>(
    "/api/inbox/:conversationId/release",
    auth,
    async (request, reply) => {
      const user = currentUser(request);

      const result = await deps.setControl.execute(request.params.conversationId, {
        action: "return_to_bot",
      });
      if (isErr(result)) throw result.error;

      deps.stream.publish(user.tenantId, {
        type: "conversation_changed",
        payload: { conversationId: request.params.conversationId, status: "OPEN" },
      });

      return reply.status(204).send();
    },
  );

  app.post<{ Params: ConversationParams }>(
    "/api/inbox/:conversationId/messages",
    auth,
    async (request, reply) => {
      const parsed = sendMessageRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError("El mensaje no puede estar vacío");

      const user = currentUser(request);
      const sent = await deps.sendHumanMessage.execute({
        conversationId: request.params.conversationId,
        userId: user.userId,
        text: parsed.data.text,
      });

      if (isErr(sent)) throw sent.error;
      return reply.status(201).send({ messageId: sent.value.messageId });
    },
  );

  /**
   * Flujo en vivo del inbox.
   *
   * Mismo patrón que el stream de canal de F1: se escribe sobre `reply.raw`
   * porque Fastify no debe serializar ni cerrar una respuesta de larga
   * duración.
   */
  app.get("/api/inbox/stream", auth, async (request, reply) => {
    const user = currentUser(request);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const write = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    write("ready", { tenantId: user.tenantId });

    const unsubscribe = deps.stream.subscribe(user.tenantId, (event) => {
      write(event.type, { type: event.type, ...event.payload });
    });

    const heartbeat = setInterval(() => {
      reply.raw.write(": ping\n\n");
    }, 20_000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      deps.logger.debug("Asesor desconectado del inbox", { userId: user.userId });
    });

    return reply;
  });
};

import type { ConversationDetail, InboxEntryContract } from "@agentinmobi/contracts";
import { Bot, Handshake, Inbox, Send, UserRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EmptyState, ErrorNotice } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api } from "../api/backoffice";
import { ApiError } from "../api/client";
import { MessageBlocks } from "../components/MessageBlocks";
import { useInboxStream } from "../hooks/useInboxStream";

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Bot activo",
  BOT_PAUSED: "Esperando asesor",
  HUMAN: "Con asesor",
  CLOSED: "Cerrada",
};

/**
 * Color del estado.
 *
 * `BOT_PAUSED` destaca porque es el único que pide acción: hay un cliente
 * esperando a que alguien entre. Si todos los estados se vieran igual, la
 * bandeja no diría nada de un vistazo.
 */
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  BOT_PAUSED: "default",
  HUMAN: "secondary",
  OPEN: "outline",
  CLOSED: "outline",
};

const AUTHOR_LABEL: Record<string, string> = {
  CONTACT: "Cliente",
  AGENT: "Sofía",
  HUMAN: "Asesor",
  SYSTEM: "Sistema",
};

const FILTERS = [
  { key: "", label: "Todas" },
  { key: "BOT_PAUSED", label: "Esperan asesor" },
  { key: "HUMAN", label: "Con asesor" },
] as const;

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Bandeja de conversaciones con toma de control.
 *
 * El flujo en vivo NO reescribe la conversación abierta a base de parches: al
 * llegar un evento se vuelven a pedir la lista y, si toca, el hilo. Mantener un
 * estado incremental a partir de eventos parciales es la vía rápida a una
 * pantalla que se desincroniza y miente sobre lo que pasó; recargar es más
 * simple, y a esta escala, indistinguible.
 */
export const InboxPage = (): ReactNode => {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();

  const [items, setItems] = useState<InboxEntryContract[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [thread, setThread] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(() => {
    api
      .inbox({ ...(status !== "" ? { status } : {}), limit: 50 })
      .then((response) => {
        setItems(response.items);
        setTotal(response.total);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "No se pudo cargar la bandeja");
      });
  }, [status]);

  const loadThread = useCallback((id: string) => {
    api
      .conversation(id)
      .then(setThread)
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "No se pudo cargar la conversación");
      });
  }, []);

  useEffect(loadList, [loadList]);

  useEffect(() => {
    if (conversationId !== undefined) loadThread(conversationId);
    else setThread(null);
  }, [conversationId, loadThread]);

  /* Lo que llega en vivo. */
  useInboxStream(
    useCallback(
      (event) => {
        loadList();
        if (event.conversationId === conversationId) loadThread(event.conversationId);
      },
      [conversationId, loadList, loadThread],
    ),
  );

  /* El hilo siempre abajo: es donde está lo último. */
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [thread]);

  const act = (action: () => Promise<void>): void => {
    setBusy(true);
    action()
      .then(() => {
        if (conversationId !== undefined) loadThread(conversationId);
        loadList();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "No se pudo completar la acción");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const send = (): void => {
    const text = draft.trim();
    if (text.length === 0 || conversationId === undefined) return;

    setDraft("");
    act(() => api.sendMessage(conversationId, text));
  };

  return (
    <div className="flex h-screen">
      {/* ------------------------------------------------------- la bandeja */}
      <div className="bg-card flex w-full max-w-xs shrink-0 flex-col border-r md:w-80">
        <div className="space-y-3 p-3">
          <div className="flex items-center justify-between">
            <h1 className="font-heading text-sm font-semibold">Conversaciones</h1>
            <span className="text-muted-foreground text-xs">{total}</span>
          </div>

          <div className="flex flex-wrap gap-1">
            {FILTERS.map((filter) => (
              <Button
                key={filter.key}
                type="button"
                size="sm"
                variant={status === filter.key ? "secondary" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setStatus(filter.key);
                }}
              >
                {filter.label}
              </Button>
            ))}
          </div>
        </div>

        <Separator />

        <ScrollArea className="flex-1">
          {items.length === 0 ? (
            <p className="text-muted-foreground p-4 text-sm">Sin conversaciones.</p>
          ) : (
            <div className="divide-y">
              {items.map((entry) => (
                <button
                  key={entry.conversationId}
                  type="button"
                  className={cn(
                    "hover:bg-accent/60 w-full space-y-1 p-3 text-left transition-colors outline-none",
                    "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset",
                    entry.conversationId === conversationId &&
                      "bg-accent border-primary border-l-2",
                  )}
                  onClick={() => {
                    void navigate(`/inbox/${entry.conversationId}`);
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">{entry.contactName}</span>
                    <span className="text-muted-foreground shrink-0 text-[11px]">
                      {formatTime(entry.lastMessageAt)}
                    </span>
                  </div>

                  <p className="text-muted-foreground line-clamp-2 text-xs">
                    <span className="font-medium">
                      {AUTHOR_LABEL[entry.lastMessageFrom] ?? entry.lastMessageFrom}:
                    </span>{" "}
                    {entry.lastMessagePreview}
                  </p>

                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-[10px]">
                      {entry.channelType}
                    </Badge>
                    <Badge
                      variant={STATUS_VARIANT[entry.status] ?? "outline"}
                      className="text-[10px]"
                    >
                      {STATUS_LABEL[entry.status] ?? entry.status}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ---------------------------------------------------------- el hilo */}
      {thread === null ? (
        <div className="flex flex-1 flex-col justify-center p-6">
          <ErrorNotice message={error} />
          <EmptyState
            icon={Inbox}
            title="Elige una conversación"
            hint="Aquí verás el hilo completo tal y como lo vio el cliente, con las mismas fichas y los mismos precios."
          />
        </div>
      ) : (
        <div className="flex min-w-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="bg-card flex h-14 shrink-0 items-center gap-2 border-b px-4">
              <span className="truncate text-sm font-semibold">{thread.contactName}</span>
              <Badge variant="outline" className="text-[10px]">
                {thread.channelType}
              </Badge>
              <Badge variant={STATUS_VARIANT[thread.status] ?? "outline"} className="text-[10px]">
                {STATUS_LABEL[thread.status] ?? thread.status}
              </Badge>

              <div className="ml-auto">
                {thread.status === "HUMAN" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      act(() => api.release(thread.conversationId));
                    }}
                  >
                    <Bot className="size-4" />
                    Devolver al bot
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      act(() => api.takeover(thread.conversationId));
                    }}
                  >
                    <Handshake className="size-4" />
                    Tomar la conversación
                  </Button>
                )}
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-4" ref={bodyRef}>
              <div className="mx-auto flex max-w-3xl flex-col gap-3">
                {thread.messages.map((message) => {
                  const entrante = message.direction === "INBOUND";
                  return (
                    <div
                      key={message.id}
                      className={cn(
                        "flex max-w-[85%] flex-col gap-1",
                        entrante ? "self-start" : "self-end items-end",
                      )}
                    >
                      <span className="text-muted-foreground px-1 text-[11px]">
                        {AUTHOR_LABEL[message.author] ?? message.author} ·{" "}
                        {formatTime(message.sentAt)}
                      </span>
                      <div
                        className={cn(
                          "rounded-lg border px-3 py-2",
                          entrante && "bg-card",
                          !entrante && message.author === "HUMAN" && "bg-primary/10 border-primary/30",
                          !entrante && message.author === "AGENT" && "bg-accent",
                          message.author === "SYSTEM" && "bg-muted border-dashed",
                        )}
                      >
                        <MessageBlocks blocks={message.blocks} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {thread.status === "HUMAN" ? (
              <div className="bg-card shrink-0 border-t p-3">
                <div className="mx-auto flex max-w-3xl items-end gap-2">
                  <Textarea
                    value={draft}
                    rows={2}
                    placeholder="Escribe al cliente…  (Enter envía, Mayús+Enter salta línea)"
                    className="min-h-0 resize-none"
                    onChange={(event) => {
                      setDraft(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        send();
                      }
                    }}
                  />
                  <Button type="button" disabled={busy} onClick={send}>
                    <Send className="size-4" />
                    Enviar
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground bg-muted/40 shrink-0 border-t p-3 text-center text-xs">
                El bot está atendiendo esta conversación. Toma el control para escribir.
              </p>
            )}
          </div>

          {/* ------------------------------------------------- lo que sabemos */}
          <aside className="bg-card hidden w-64 shrink-0 border-l lg:block">
            <ScrollArea className="h-screen">
              <div className="space-y-4 p-4">
                <div className="space-y-2">
                  <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
                    <UserRound className="size-3.5" />
                    Lo que sabemos
                  </h2>

                  {thread.profile.length === 0 ? (
                    <p className="text-muted-foreground text-xs">Todavía nada.</p>
                  ) : (
                    <dl className="space-y-2">
                      {thread.profile.map((slot) => (
                        <div key={slot.name} className="space-y-0.5">
                          <dt className="text-muted-foreground text-[11px]">{slot.name}</dt>
                          <dd className="flex items-center gap-1.5 text-sm">
                            {slot.value}
                            {/*
                             * La procedencia importa: lo deducido puede estar
                             * mal, y el asesor tiene que saber cuándo el dato
                             * lo dijo el cliente y cuándo lo supuso el sistema.
                             */}
                            <Badge variant="outline" className="text-[9px]">
                              {slot.source === "inferred" ? "deducido" : slot.source}
                            </Badge>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>

                {thread.missingRequiredSlots.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <h2 className="text-xs font-semibold tracking-wide uppercase">
                        Falta por saber
                      </h2>
                      <div className="flex flex-wrap gap-1">
                        {thread.missingRequiredSlots.map((slot) => (
                          <Badge key={slot} variant="secondary" className="text-[10px] font-normal">
                            {slot}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </ScrollArea>
          </aside>
        </div>
      )}
    </div>
  );
};

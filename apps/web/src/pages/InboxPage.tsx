import type { ConversationDetail, InboxEntryContract } from "@agentinmobi/contracts";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
    <div className="inbox">
      <div className="inbox__list">
        <div className="inbox__filters">
          {FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={`chip${status === filter.key ? " is-active" : ""}`}
              onClick={() => {
                setStatus(filter.key);
              }}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {items.length === 0 && <p className="empty" style={{ padding: 16 }}>Sin conversaciones.</p>}

        {items.map((entry) => (
          <button
            key={entry.conversationId}
            type="button"
            className={`inbox__item${entry.conversationId === conversationId ? " is-active" : ""}`}
            onClick={() => {
              void navigate(`/inbox/${entry.conversationId}`);
            }}
          >
            <div className="inbox__item-top">
              <span className="inbox__name">{entry.contactName}</span>
              <span className="inbox__time">{formatTime(entry.lastMessageAt)}</span>
            </div>
            <div className="inbox__preview">
              {AUTHOR_LABEL[entry.lastMessageFrom] ?? entry.lastMessageFrom}:{" "}
              {entry.lastMessagePreview}
            </div>
            <div className="inbox__meta">
              <span className="badge">{entry.channelType}</span>
              <span className="badge">{STATUS_LABEL[entry.status] ?? entry.status}</span>
            </div>
          </button>
        ))}
      </div>

      {thread === null ? (
        <div className="page">
          <div className="page__header">
            <h1>Conversaciones</h1>
            <span className="page__count">{total} en total</span>
          </div>
          {error !== null && <p className="error">{error}</p>}
          <p className="empty">Elige una conversación para ver el hilo.</p>
        </div>
      ) : (
        <div className="thread">
          <header className="thread__header">
            <span className="thread__title">{thread.contactName}</span>
            <span className="badge">{thread.channelType}</span>
            <span className="badge">{STATUS_LABEL[thread.status] ?? thread.status}</span>

            <div className="thread__actions">
              {thread.status === "HUMAN" ? (
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    act(() => api.release(thread.conversationId));
                  }}
                >
                  Devolver al bot
                </button>
              ) : (
                <button
                  type="button"
                  className="button button--primary"
                  disabled={busy}
                  onClick={() => {
                    act(() => api.takeover(thread.conversationId));
                  }}
                >
                  Tomar la conversación
                </button>
              )}
            </div>
          </header>

          <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
              <div className="thread__body" ref={bodyRef}>
                {thread.messages.map((message) => (
                  <div
                    key={message.id}
                    className={[
                      "msg",
                      message.direction === "INBOUND" ? "msg--in" : "msg--out",
                      message.author === "HUMAN" ? "msg--human" : "",
                      message.author === "SYSTEM" ? "msg--system" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span className="msg__author">
                      {AUTHOR_LABEL[message.author] ?? message.author} ·{" "}
                      {formatTime(message.sentAt)}
                    </span>
                    <div className="msg__bubble">
                      <MessageBlocks blocks={message.blocks} />
                    </div>
                  </div>
                ))}
              </div>

              {thread.status === "HUMAN" ? (
                <div className="composer">
                  <textarea
                    value={draft}
                    placeholder="Escribe al cliente…"
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
                  <button type="button" className="button button--primary" disabled={busy} onClick={send}>
                    Enviar
                  </button>
                </div>
              ) : (
                <p className="composer__hint">
                  El bot está atendiendo esta conversación. Toma el control para escribir.
                </p>
              )}
            </div>

            <aside className="profile">
              <h3>Lo que sabemos</h3>
              {thread.profile.length === 0 && <p className="empty">Todavía nada.</p>}
              {thread.profile.map((slot) => (
                <div key={slot.name} className="profile__row">
                  <span className="profile__label">{slot.name}</span>
                  <span>{slot.value}</span>
                  <span className="profile__source">
                    {slot.source === "inferred" ? "deducido" : slot.source}
                  </span>
                </div>
              ))}

              {thread.missingRequiredSlots.length > 0 && (
                <>
                  <h3 style={{ marginTop: 18 }}>Falta por saber</h3>
                  <p className="empty">{thread.missingRequiredSlots.join(", ")}</p>
                </>
              )}
            </aside>
          </div>
        </div>
      )}
    </div>
  );
};

import {
  consoleStreamMessageSchema,
  type ChannelAccountContract,
  type ReplyBlockContract,
} from "@agentinmobi/contracts";
import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { api } from "../api/backoffice";
import { ApiError } from "../api/client";
import { MessageBlocks } from "../components/MessageBlocks";

interface Turn {
  readonly id: string;
  readonly author: "customer" | "agent";
  readonly blocks: readonly ReplyBlockContract[];
  readonly at: string;
}

/** Identificador del cliente simulado. Uno nuevo = conversación nueva. */
const newVisitorRef = (): string =>
  `sim-${globalThis.crypto.randomUUID().slice(0, 8)}`;

/**
 * Simulador: hablar con tu propio agente.
 *
 * La decisión que lo hace útil es que **no hay ruta especial**. El navegador
 * pregunta cuál es la cuenta de consola de su inmobiliaria y después habla con
 * ella por la MISMA ruta pública que usaría un cliente final. Mismo caso de
 * uso, mismo agente, mismas herramientas, misma conversación persistida — que
 * además aparece en el inbox como cualquier otra.
 *
 * Un simulador con su propio atajo interno probaría un camino que nadie usa, y
 * fallaría justo el día que hace falta.
 *
 * "Reiniciar" no borra nada: genera un remitente nuevo. Para el sistema es
 * otra persona, así que empieza una conversación limpia sin tocar el historial
 * de la anterior — que sigue ahí para revisarla.
 */
export const PlaygroundPage = (): ReactNode => {
  const [account, setAccount] = useState<ChannelAccountContract | null>(null);
  const [visitorRef, setVisitorRef] = useState(newVisitorRef);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    api
      .channelAccounts()
      .then((response) => {
        const console_ = response.items.find(
          (item) => item.channelType === "CONSOLE" && item.isActive,
        );
        if (!console_) {
          setError(
            "Esta inmobiliaria no tiene un canal de simulación dado de alta. Sin él no hay por dónde hablar con el agente.",
          );
          return;
        }
        setAccount(console_);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "No se pudieron cargar los canales");
      });
  }, []);

  useEffect(() => {
    if (account === null) return;

    const source = new EventSource(
      `/api/channels/console/${encodeURIComponent(account.externalId)}/stream`,
    );

    const handle = (raw: MessageEvent<string>): void => {
      try {
        const parsed = consoleStreamMessageSchema.safeParse(JSON.parse(raw.data));
        if (!parsed.success) return;
        // El flujo es de la CUENTA, no de una conversación: hay que quedarse
        // solo con lo dirigido a este cliente simulado.
        if (parsed.data.to !== visitorRef) return;

        setTurns((current) => [
          ...current,
          {
            id: parsed.data.messageId,
            author: "agent",
            blocks: parsed.data.blocks,
            at: parsed.data.sentAt,
          },
        ]);
        setWaiting(false);
      } catch {
        // Un evento ilegible no puede tumbar la pantalla.
      }
    };

    source.addEventListener("message", handle);

    return () => {
      source.close();
    };
  }, [account, visitorRef]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  const send = (event: SyntheticEvent): void => {
    event.preventDefault();
    const message = text.trim();
    if (account === null || message.length === 0) return;

    setTurns((current) => [
      ...current,
      {
        id: `local-${String(current.length)}`,
        author: "customer",
        blocks: [{ kind: "text", text: message }],
        at: new Date().toISOString(),
      },
    ]);
    setText("");
    setWaiting(true);
    setError(null);

    // Ruta PÚBLICA del canal, la misma que usaría un cliente. Sin sesión y sin
    // validar la respuesta contra un contrato del panel: lo único que dice es
    // "recibido", y la respuesta real llega por el flujo.
    fetch(`/api/channels/console/${encodeURIComponent(account.externalId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: visitorRef, displayName: "Cliente de prueba", text: message }),
    })
      .then((response) => {
        if (!response.ok) {
          setWaiting(false);
          setError(`El canal rechazó el mensaje (${String(response.status)})`);
        }
      })
      .catch(() => {
        setWaiting(false);
        setError("No se pudo enviar el mensaje");
      });
  };

  const restart = (): void => {
    setVisitorRef(newVisitorRef());
    setTurns([]);
    setWaiting(false);
    setError(null);
  };

  return (
    <div className="page playground">
      <div className="page__header">
        <h1>Simulador</h1>
        <div className="playground__meta">
          <code>{visitorRef}</code>
          <button type="button" className="button button--ghost" onClick={restart}>
            Empezar de nuevo
          </button>
        </div>
      </div>

      <p className="hint">
        Hablas con tu agente por el mismo camino que un cliente real. Lo que ocurra aquí queda en
        el inbox y genera leads y citas de verdad.
      </p>

      {error !== null && <p className="error">{error}</p>}

      <div className="playground__thread">
        {turns.length === 0 && (
          <p className="empty">
            Escribe como si fueras un cliente: «Busco apartamento de 2 habitaciones en Laureles».
          </p>
        )}

        {turns.map((turn) => (
          <div key={turn.id} className={`bubble bubble--${turn.author}`}>
            <MessageBlocks blocks={turn.blocks} />
          </div>
        ))}

        {waiting && <div className="bubble bubble--agent bubble--waiting">Escribiendo…</div>}
        <div ref={bottom} />
      </div>

      <form className="playground__composer" onSubmit={send}>
        <input
          value={text}
          placeholder="Escribe como cliente…"
          disabled={account === null}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <button
          type="submit"
          className="button button--primary"
          disabled={account === null || text.trim().length === 0}
        >
          Enviar
        </button>
      </form>
    </div>
  );
};

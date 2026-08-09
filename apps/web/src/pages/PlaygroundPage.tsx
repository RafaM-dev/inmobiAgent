import {
  consoleStreamMessageSchema,
  type ChannelAccountContract,
  type ReplyBlockContract,
} from "@agentinmobi/contracts";
import { RotateCcw, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { ErrorNotice, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
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
const newVisitorRef = (): string => `sim-${globalThis.crypto.randomUUID().slice(0, 8)}`;

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
 * "Empezar de nuevo" no borra nada: genera un remitente nuevo. Para el sistema
 * es otra persona, así que empieza una conversación limpia sin tocar el
 * historial de la anterior — que sigue ahí para revisarla.
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
    <div className="mx-auto flex h-screen w-full max-w-3xl flex-col p-6">
      <PageHeader
        title="Simulador"
        description="Hablas con tu agente por el mismo camino que un cliente real. Lo que ocurra aquí queda en el inbox y genera leads y citas de verdad."
      >
        <Badge variant="outline" className="font-mono text-[10px]">
          {visitorRef}
        </Badge>
        <Button type="button" variant="outline" size="sm" onClick={restart}>
          <RotateCcw className="size-4" />
          Empezar de nuevo
        </Button>
      </PageHeader>

      <div className="pt-4">
        <ErrorNotice message={error} />
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-4">
        {turns.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Sparkles className="text-muted-foreground/60 size-7" />
            <p className="text-muted-foreground max-w-sm text-sm">
              Escribe como si fueras un cliente: «Busco apartamento de 2 habitaciones en
              Laureles».
            </p>
          </div>
        )}

        {turns.map((turn) => (
          <div
            key={turn.id}
            className={cn(
              "flex w-fit max-w-[85%] flex-col rounded-lg border px-3 py-2",
              turn.author === "customer"
                ? "bg-primary text-primary-foreground ml-auto border-transparent"
                : "bg-card",
            )}
          >
            <MessageBlocks blocks={turn.blocks} />
          </div>
        ))}

        {waiting && (
          <div className="bg-card text-muted-foreground w-fit rounded-lg border px-3 py-2 text-sm">
            <span className="inline-flex gap-1">
              Escribiendo
              <span className="animate-pulse">…</span>
            </span>
          </div>
        )}
        <div ref={bottom} />
      </div>

      <form className="flex shrink-0 gap-2 border-t pt-3" onSubmit={send}>
        <Input
          value={text}
          placeholder="Escribe como cliente…"
          disabled={account === null}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <Button type="submit" disabled={account === null || text.trim().length === 0}>
          <Send className="size-4" />
          Enviar
        </Button>
      </form>
    </div>
  );
};

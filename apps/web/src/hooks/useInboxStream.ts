import { inboxEventSchema, type InboxEvent } from "@agentinmobi/contracts";
import { useEffect, useRef } from "react";

/**
 * Escucha el flujo en vivo del inbox.
 *
 * `EventSource` y no WebSocket: el tráfico va en una sola dirección —el
 * servidor avisa, el navegador no dice nada—, se reconecta solo y viaja por
 * HTTP normal, que es lo que atraviesa proxies corporativos sin pelearse con
 * nadie. Además manda la cookie de sesión por sí mismo al ser del mismo origen.
 *
 * El listener se guarda en una `ref` para que cambiar la función no reabra la
 * conexión: reconectar en cada render tiraría el flujo constantemente.
 */
export const useInboxStream = (onEvent: (event: InboxEvent) => void): void => {
  const listener = useRef(onEvent);
  listener.current = onEvent;

  useEffect(() => {
    const source = new EventSource("/api/inbox/stream");

    const handle = (raw: MessageEvent<string>): void => {
      try {
        const parsed = inboxEventSchema.safeParse(JSON.parse(raw.data));
        if (parsed.success) listener.current(parsed.data);
      } catch {
        // Un evento ilegible no puede tumbar el inbox del asesor.
      }
    };

    source.addEventListener("message", handle);
    source.addEventListener("conversation_changed", handle);

    return () => {
      source.close();
    };
  }, []);
};

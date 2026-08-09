import type { InboxEvent } from "@agentinmobi/contracts";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useInboxStream } from "./useInboxStream";

/**
 * FLUJO EN VIVO DEL INBOX.
 *
 * Lo que llega por aquí viene de la red y puede ser cualquier cosa: un evento a
 * medias porque se cortó la conexión, un formato nuevo que el backend empezó a
 * mandar, una reconexión que reenvía lo mismo. Nada de eso puede tumbar la
 * pantalla donde un asesor está atendiendo a un cliente.
 */

type Listener = (event: MessageEvent<string>) => void;

/** `EventSource` de mentira: permite empujar eventos y ver si se cerró. */
class FakeEventSource {
  static ultima: FakeEventSource | undefined;

  readonly listeners = new Map<string, Listener[]>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.ultima = this;
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  /** Simula un mensaje del servidor. */
  emit(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data }));
    }
  }
}

const EVENTO: InboxEvent = {
  type: "conversation_changed",
  conversationId: "019fd528-f63e-74de-8fe5-bdd2a45333ac",
  status: "OPEN",
};

describe("Flujo en vivo del inbox", () => {
  beforeEach(() => {
    FakeEventSource.ultima = undefined;
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  it("se conecta al flujo del inbox", () => {
    renderHook(() => {
      useInboxStream(() => undefined);
    });

    expect(FakeEventSource.ultima?.url).toBe("/api/inbox/stream");
  });

  it("entrega los eventos válidos ya tipados", () => {
    const recibidos: unknown[] = [];
    renderHook(() => {
      useInboxStream((event) => recibidos.push(event));
    });

    FakeEventSource.ultima?.emit("conversation_changed", JSON.stringify(EVENTO));

    expect(recibidos).toEqual([EVENTO]);
  });

  it("un evento con JSON roto no tumba el inbox", () => {
    const recibidos: unknown[] = [];
    renderHook(() => {
      useInboxStream((event) => recibidos.push(event));
    });

    // Una conexión que se corta a mitad manda exactamente esto.
    expect(() => {
      FakeEventSource.ultima?.emit("message", "{ esto no es json");
    }).not.toThrow();

    expect(recibidos).toEqual([]);
  });

  it("un evento con forma desconocida se descarta en silencio", () => {
    const recibidos: unknown[] = [];
    renderHook(() => {
      useInboxStream((event) => recibidos.push(event));
    });

    /*
     * El backend puede empezar a emitir un tipo de evento que este panel
     * todavía no entiende. Descartarlo es correcto; pasarlo al componente sin
     * validar sería el `undefined is not a function` de siempre.
     */
    FakeEventSource.ultima?.emit("message", JSON.stringify({ type: "algo_nuevo" }));

    expect(recibidos).toEqual([]);
  });

  it("escucha tanto los mensajes genéricos como los con nombre", () => {
    const recibidos: unknown[] = [];
    renderHook(() => {
      useInboxStream((event) => recibidos.push(event));
    });

    // SSE permite eventos con nombre; según cómo los emita el servidor llegan
    // por un canal o por el otro, y perderse la mitad sería un inbox a medias.
    FakeEventSource.ultima?.emit("message", JSON.stringify(EVENTO));
    FakeEventSource.ultima?.emit("conversation_changed", JSON.stringify(EVENTO));

    expect(recibidos).toHaveLength(2);
  });

  it("cambiar el manejador NO reabre la conexión", () => {
    const primero = vi.fn();
    const segundo = vi.fn();

    const { rerender } = renderHook(
      ({ handler }: { handler: (event: InboxEvent) => void }) => {
        useInboxStream(handler);
      },
      { initialProps: { handler: primero } },
    );

    const conexion = FakeEventSource.ultima;
    rerender({ handler: segundo });

    /*
     * El manejador se recrea en cada render de la pantalla. Si eso reabriera el
     * flujo, el inbox estaría reconectándose constantemente y perdería eventos
     * en cada salto.
     */
    expect(FakeEventSource.ultima).toBe(conexion);
    expect(conexion?.closed).toBe(false);

    // Y el nuevo manejador es el que recibe: la `ref` está al día.
    FakeEventSource.ultima?.emit("message", JSON.stringify(EVENTO));
    expect(primero).not.toHaveBeenCalled();
    expect(segundo).toHaveBeenCalledOnce();
  });

  it("cierra la conexión al salir de la pantalla", () => {
    const { unmount } = renderHook(() => {
      useInboxStream(() => undefined);
    });
    const conexion = FakeEventSource.ultima;

    unmount();

    // Una conexión SSE que no se cierra consume una de las pocas que el
    // navegador permite por origen, y el servidor mantiene el flujo abierto.
    expect(conexion?.closed).toBe(true);
  });
});

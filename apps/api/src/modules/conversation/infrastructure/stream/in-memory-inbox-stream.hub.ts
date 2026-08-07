import type {
  InboxStreamEvent,
  InboxStreamHub,
  InboxStreamListener,
} from "../../application/ports/inbox-stream";

/**
 * Hub en memoria del inbox.
 *
 * Un fallo de un oyente no puede tumbar a los demás: si el navegador de un
 * asesor cerró la conexión a medias, escribir en su respuesta lanza, y sin este
 * aislamiento se llevaría por delante la notificación del resto del equipo.
 */
export class InMemoryInboxStreamHub implements InboxStreamHub {
  private readonly listeners = new Map<string, Set<InboxStreamListener>>();

  publish(tenantId: string, event: InboxStreamEvent): void {
    const subscribers = this.listeners.get(tenantId);
    if (!subscribers) return;

    for (const listener of subscribers) {
      try {
        listener(event);
      } catch {
        // Conexión rota. La limpieza la hace el `unsubscribe` del propio
        // cliente al cerrarse; aquí solo se evita el contagio.
      }
    }
  }

  subscribe(tenantId: string, listener: InboxStreamListener): () => void {
    const subscribers = this.listeners.get(tenantId) ?? new Set<InboxStreamListener>();
    subscribers.add(listener);
    this.listeners.set(tenantId, subscribers);

    return () => {
      subscribers.delete(listener);
      if (subscribers.size === 0) this.listeners.delete(tenantId);
    };
  }

  connectionCount(tenantId: string): number {
    return this.listeners.get(tenantId)?.size ?? 0;
  }
}

import type {
  ChannelStreamEvent,
  ChannelStreamHub,
  ChannelStreamListener,
} from "../../application/ports/channel-stream";

/**
 * Hub de streaming en memoria.
 *
 * Sirve a los canales cuyo destinatario está conectado a nuestra propia API
 * (consola hoy, web chat en F7). Un fallo en un suscriptor no puede afectar a
 * los demás: por eso cada entrega va aislada.
 *
 * Límite conocido y asumido: solo funciona dentro de un proceso. Con varias
 * réplicas, la implementación pasa a Redis pub/sub — el puerto no cambia.
 */
export class InMemoryChannelStreamHub implements ChannelStreamHub {
  private readonly listeners = new Map<string, Set<ChannelStreamListener>>();

  publish(channelAccountId: string, event: ChannelStreamEvent): void {
    const subscribers = this.listeners.get(channelAccountId);
    if (!subscribers) return;

    for (const listener of subscribers) {
      try {
        listener(event);
      } catch {
        // Un cliente que se desconectó a media escritura no puede tumbar al resto.
      }
    }
  }

  subscribe(channelAccountId: string, listener: ChannelStreamListener): () => void {
    const subscribers = this.listeners.get(channelAccountId) ?? new Set<ChannelStreamListener>();
    subscribers.add(listener);
    this.listeners.set(channelAccountId, subscribers);

    return () => {
      subscribers.delete(listener);
      if (subscribers.size === 0) this.listeners.delete(channelAccountId);
    };
  }

  subscriberCount(channelAccountId: string): number {
    return this.listeners.get(channelAccountId)?.size ?? 0;
  }
}

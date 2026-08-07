/**
 * Canal de vuelta hacia clientes conectados en vivo (SSE/WebSocket).
 *
 * Lo usan los canales "de cliente" —consola hoy, web chat en F7—, donde no hay
 * un proveedor externo al que llamar: el destinatario está conectado a nuestra
 * propia API. La implementación en memoria basta mientras haya un solo proceso;
 * con varias réplicas se sustituye por Redis pub/sub sin tocar este puerto.
 */

export interface ChannelStreamEvent {
  readonly type: "message" | "system";
  readonly payload: unknown;
}

export type ChannelStreamListener = (event: ChannelStreamEvent) => void;

export interface ChannelStreamHub {
  /** Emite a todos los clientes conectados a esa cuenta de canal. */
  publish(channelAccountId: string, event: ChannelStreamEvent): void;
  /** Devuelve la función de baja. Llamarla es responsabilidad del suscriptor. */
  subscribe(channelAccountId: string, listener: ChannelStreamListener): () => void;
  subscriberCount(channelAccountId: string): number;
}

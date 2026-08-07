/**
 * PUERTO del flujo en vivo de la bandeja.
 *
 * Es el equivalente para el asesor de lo que `ChannelStreamHub` es para el
 * cliente: empujar lo que pasa sin que nadie pregunte. La diferencia está en la
 * clave — aquél se agrupa por cuenta de canal, éste por INMOBILIARIA, porque un
 * asesor ve todas las conversaciones de la suya y ninguna de otra.
 *
 * En memoria hoy; con varias réplicas hará falta Redis detrás de este mismo
 * puerto para que un asesor conectado a la réplica A vea lo que llega por la B.
 */

export interface InboxStreamEvent {
  readonly type: "message" | "conversation_changed";
  readonly payload: Readonly<Record<string, unknown>>;
}

export type InboxStreamListener = (event: InboxStreamEvent) => void;

export interface InboxStreamHub {
  /** Empuja a todos los asesores conectados de esa inmobiliaria. */
  publish(tenantId: string, event: InboxStreamEvent): void;
  /** Devuelve la función para darse de baja. */
  subscribe(tenantId: string, listener: InboxStreamListener): () => void;
  connectionCount(tenantId: string): number;
}

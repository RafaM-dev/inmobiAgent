/**
 * Lo que un canal sabe hacer.
 *
 * Es la pieza que permite que el agente ignore por completo el canal: en vez de
 * preguntar "¿estoy en WhatsApp?", el sistema pregunta "¿este canal soporta
 * botones?". Añadir Telegram mañana es rellenar esta estructura, no tocar
 * ninguna decisión de negocio.
 */
export interface ChannelCapabilities {
  /** Botones de respuesta rápida. Si no, se degradan a lista numerada. */
  readonly supportsQuickReplies: boolean;
  /** Tarjetas/carruseles. Si no, se envían fichas como texto estructurado. */
  readonly supportsRichCards: boolean;
  readonly supportsMedia: boolean;
  /** Enlaces con vista previa; si no, la URL va en línea. */
  readonly supportsLinkPreview: boolean;
  /** Token a token (SSE). WhatsApp no; el web chat sí. */
  readonly supportsStreaming: boolean;
  readonly supportsTypingIndicator: boolean;
  /** Máximo de caracteres por mensaje; el renderer trocea si hace falta. */
  readonly maxTextLength: number;
  /** Cuántos mensajes seguidos es aceptable enviar por turno. */
  readonly maxMessagesPerTurn: number;
}

export const defaultCapabilities = (
  overrides: Partial<ChannelCapabilities> = {},
): ChannelCapabilities => ({
  supportsQuickReplies: false,
  supportsRichCards: false,
  supportsMedia: false,
  supportsLinkPreview: false,
  supportsStreaming: false,
  supportsTypingIndicator: false,
  maxTextLength: 4000,
  maxMessagesPerTurn: 3,
  ...overrides,
});

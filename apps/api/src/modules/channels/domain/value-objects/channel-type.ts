/**
 * Canales soportados.
 *
 * Que WhatsApp aparezca en esta lista no contradice el principio 2: aquí es un
 * *valor*, no una dependencia. Ninguna rama de la lógica de negocio puede
 * preguntar "¿es WhatsApp?" para comportarse distinto; para eso están las
 * capacidades del canal (`ChannelCapabilities`).
 */
export const ChannelType = {
  CONSOLE: "CONSOLE",
  WEBCHAT: "WEBCHAT",
  WHATSAPP: "WHATSAPP",
  TELEGRAM: "TELEGRAM",
  MESSENGER: "MESSENGER",
  INSTAGRAM: "INSTAGRAM",
} as const;
export type ChannelType = (typeof ChannelType)[keyof typeof ChannelType];

const VALUES = new Set<string>(Object.values(ChannelType));

/** Convierte un segmento de URL (`console`) al tipo de canal. */
export const parseChannelType = (value: string): ChannelType | null => {
  const upper = value.trim().toUpperCase();
  return VALUES.has(upper) ? (upper as ChannelType) : null;
};

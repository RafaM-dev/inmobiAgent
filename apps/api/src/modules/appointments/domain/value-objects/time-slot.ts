/**
 * Una franja concreta para visitar un inmueble.
 *
 * El instante se guarda SIEMPRE en UTC. La zona horaria del tenant se usa para
 * decidir qué franjas existen y para escribirlas en un mensaje, nunca para
 * almacenarlas: una cita guardada en hora local es una cita que se mueve sola
 * cuando alguien cambia la configuración del servidor.
 */
export interface TimeSlot {
  readonly startsAt: Date;
  readonly durationMin: number;
}

export const slotEndsAt = (slot: TimeSlot): Date =>
  new Date(slot.startsAt.getTime() + slot.durationMin * 60_000);

export const slotsOverlap = (a: TimeSlot, b: TimeSlot): boolean =>
  a.startsAt.getTime() < slotEndsAt(b).getTime() &&
  b.startsAt.getTime() < slotEndsAt(a).getTime();

/* -------------------------------------------------------------------------- *
 * Referencia opaca de franja
 *
 * El modelo NO escribe fechas. Elige entre las franjas que se le ofrecieron, y
 * las devuelve por esta referencia. Es la misma regla anti-alucinación que con
 * los precios (docs §7.3, paso 5): un modelo que redacta "el jueves a las 3"
 * puede equivocarse de jueves, y el cliente se planta en una oficina cerrada.
 *
 * No lleva firma criptográfica a propósito: no hace falta. Quien la recibe
 * vuelve a validar que la franja cae en horario, que sigue en el futuro y que
 * nadie la ocupó mientras tanto. Falsificar una referencia solo sirve para
 * pedir una franja que el sistema rechazará igual.
 * -------------------------------------------------------------------------- */

export const encodeSlot = (slot: TimeSlot): string =>
  Buffer.from(
    JSON.stringify({ s: slot.startsAt.toISOString(), d: slot.durationMin }),
    "utf8",
  ).toString("base64url");

export const decodeSlot = (reference: string): TimeSlot | null => {
  try {
    const raw: unknown = JSON.parse(Buffer.from(reference, "base64url").toString("utf8"));
    if (typeof raw !== "object" || raw === null) return null;

    const { s, d } = raw as { s?: unknown; d?: unknown };
    if (typeof s !== "string" || typeof d !== "number") return null;

    const startsAt = new Date(s);
    if (Number.isNaN(startsAt.getTime()) || d <= 0 || d > 480) return null;

    return { startsAt, durationMin: d };
  } catch {
    // Una referencia corrupta es un dato inválido, no una excepción: quien
    // llama la trata como "esa franja ya no vale" y ofrece otras.
    return null;
  }
};

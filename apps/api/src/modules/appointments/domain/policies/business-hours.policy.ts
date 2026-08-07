import { slotsOverlap, type TimeSlot } from "../value-objects/time-slot";

/**
 * POLÍTICA DE HORARIO — qué franjas existen y cuáles se pueden ofrecer.
 *
 * Función pura. No sabe qué es una cita, ni un asesor, ni una base de datos:
 * recibe el horario de la inmobiliaria, los huecos ya ocupados y el momento
 * actual, y devuelve franjas. Por eso se puede probar el cambio de horario de
 * verano, el fin de semana o el último hueco del día sin levantar nada.
 *
 * Todo el cálculo de calendario se hace en la ZONA HORARIA DEL TENANT. Una
 * inmobiliaria de Bogotá y otra de Madrid no comparten "las nueve de la mañana",
 * y el servidor no tiene voz en esto: su reloj local es irrelevante.
 */

export interface WorkingHours {
  /** Días activos, 0 = domingo. */
  readonly days: readonly number[];
  /** "09:00" en la zona horaria del tenant. */
  readonly from: string;
  readonly to: string;
}

/** Horario por defecto en Colombia: lunes a sábado, 9 a 17. */
export const DEFAULT_WORKING_HOURS: WorkingHours = {
  days: [1, 2, 3, 4, 5, 6],
  from: "09:00",
  to: "17:00",
};

export interface ProposeSlotsInput {
  readonly now: Date;
  readonly timezone: string;
  readonly hours: WorkingHours;
  readonly durationMin: number;
  /**
   * Antelación mínima. Sin esto se le ofrecería al cliente una visita dentro de
   * diez minutos, a la que no llegaría ni él ni el asesor.
   */
  readonly minLeadMinutes: number;
  /** Cuántos días vista se exploran. */
  readonly horizonDays: number;
  readonly limit: number;
  /** Huecos ya ocupados. Vienen del calendario, no de esta política. */
  readonly busy?: readonly TimeSlot[];
  /** Día preferido por el cliente, en la zona del tenant. Si no hay franjas
   *  libres ese día, se sigue proponiendo el resto en vez de no ofrecer nada. */
  readonly preferredDate?: Date;
}

interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

const FORMAT_CACHE = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const cached = FORMAT_CACHE.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  FORMAT_CACHE.set(timeZone, formatter);
  return formatter;
};

/** Reloj de pared del tenant para un instante dado. */
export const zonedParts = (instant: Date, timezone: string): ZonedParts => {
  const parts = formatterFor(timezone).formatToParts(instant);
  const value = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
};

/**
 * Instante UTC correspondiente a una hora de pared del tenant.
 *
 * Dos pasadas porque el desfase depende del propio instante: en un cambio de
 * horario de verano, la primera estimación puede caer al otro lado del salto.
 * Colombia no lo tiene, pero el producto se venderá donde sí.
 */
const fromZonedTime = (
  parts: ZonedParts,
  timezone: string,
): Date => {
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);

  const offsetAt = (guess: number): number => {
    const observed = zonedParts(new Date(guess), timezone);
    const asUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
    );
    return asUtc - guess;
  };

  const first = wall - offsetAt(wall);
  return new Date(wall - offsetAt(first));
};

const parseTime = (value: string): { hour: number; minute: number } => {
  const [hour, minute] = value.split(":");
  return { hour: Number(hour ?? 0), minute: Number(minute ?? 0) };
};

/** Día de la semana (0 = domingo) de una fecha de calendario del tenant. */
const weekdayOf = (parts: ZonedParts): number =>
  new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();

const addDays = (parts: ZonedParts, days: number): ZonedParts => {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
  };
};

const sameCalendarDay = (a: ZonedParts, b: ZonedParts): boolean =>
  a.year === b.year && a.month === b.month && a.day === b.day;

export const proposeSlots = (input: ProposeSlotsInput): readonly TimeSlot[] => {
  const open = parseTime(input.hours.from);
  const close = parseTime(input.hours.to);
  const closeMinutes = close.hour * 60 + close.minute;

  const earliest = input.now.getTime() + input.minLeadMinutes * 60_000;
  const today = zonedParts(input.now, input.timezone);
  const preferred = input.preferredDate
    ? zonedParts(input.preferredDate, input.timezone)
    : undefined;

  const candidates: TimeSlot[] = [];

  for (let dayOffset = 0; dayOffset <= input.horizonDays; dayOffset += 1) {
    const day = addDays(today, dayOffset);
    if (!input.hours.days.includes(weekdayOf(day))) continue;

    for (
      let minutes = open.hour * 60 + open.minute;
      minutes + input.durationMin <= closeMinutes;
      minutes += input.durationMin
    ) {
      const startsAt = fromZonedTime(
        { ...day, hour: Math.floor(minutes / 60), minute: minutes % 60 },
        input.timezone,
      );

      if (startsAt.getTime() < earliest) continue;

      const slot: TimeSlot = { startsAt, durationMin: input.durationMin };
      if (input.busy?.some((taken) => slotsOverlap(slot, taken))) continue;

      candidates.push(slot);
    }
  }

  // El día preferido primero, el resto detrás: si el cliente dijo "el jueves"
  // y el jueves está lleno, ve alternativas en vez de un "no hay nada".
  if (preferred) {
    candidates.sort((a, b) => {
      const aPreferred = sameCalendarDay(zonedParts(a.startsAt, input.timezone), preferred);
      const bPreferred = sameCalendarDay(zonedParts(b.startsAt, input.timezone), preferred);
      if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;
      return a.startsAt.getTime() - b.startsAt.getTime();
    });
  }

  return candidates.slice(0, input.limit);
};

/** ¿Cae esta franja dentro del horario de atención? Valida lo que llega de fuera. */
export const isWithinWorkingHours = (
  slot: TimeSlot,
  timezone: string,
  hours: WorkingHours,
): boolean => {
  const start = zonedParts(slot.startsAt, timezone);
  if (!hours.days.includes(weekdayOf(start))) return false;

  const open = parseTime(hours.from);
  const close = parseTime(hours.to);
  const startMinutes = start.hour * 60 + start.minute;

  return (
    startMinutes >= open.hour * 60 + open.minute &&
    startMinutes + slot.durationMin <= close.hour * 60 + close.minute
  );
};

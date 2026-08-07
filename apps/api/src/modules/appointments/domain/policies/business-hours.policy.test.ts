import { describe, expect, it } from "vitest";
import { slotEndsAt, type TimeSlot } from "../value-objects/time-slot";
import {
  DEFAULT_WORKING_HOURS,
  isWithinWorkingHours,
  proposeSlots,
  zonedParts,
  type ProposeSlotsInput,
} from "./business-hours.policy";

/** Jueves 6 de agosto de 2026, 07:00 en Bogotá (12:00 UTC). */
const NOW = new Date("2026-08-06T12:00:00Z");
const BOGOTA = "America/Bogota";

const input = (patch: Partial<ProposeSlotsInput> = {}): ProposeSlotsInput => ({
  now: NOW,
  timezone: BOGOTA,
  hours: DEFAULT_WORKING_HOURS,
  durationMin: 60,
  minLeadMinutes: 120,
  horizonDays: 7,
  limit: 3,
  ...patch,
});

describe("Política de horario — qué franjas existen de verdad", () => {
  it("propone las primeras horas del día en la zona horaria de la inmobiliaria", () => {
    const slots = proposeSlots(input());

    expect(slots).toHaveLength(3);
    // 09:00 en Bogotá son las 14:00 UTC. Guardar 09:00 sería guardar una
    // cita que se mueve sola.
    expect(slots[0]?.startsAt.toISOString()).toBe("2026-08-06T14:00:00.000Z");
    expect(slots[1]?.startsAt.toISOString()).toBe("2026-08-06T15:00:00.000Z");
  });

  it("no ofrece nada dentro de la antelación mínima", () => {
    // Las 14:30 en Bogotá: las 15:00 quedan a media hora y no valen.
    const slots = proposeSlots(input({ now: new Date("2026-08-06T19:30:00Z") }));

    expect(slots[0]?.startsAt.toISOString()).toBe("2026-08-07T14:00:00.000Z");
  });

  it("respeta el cierre: ninguna franja termina después de la hora de cierre", () => {
    const slots = proposeSlots(input({ limit: 50 }));

    for (const slot of slots) {
      const end = zonedParts(slotEndsAt(slot), BOGOTA);
      expect(end.hour * 60 + end.minute).toBeLessThanOrEqual(17 * 60);
    }
  });

  it("salta los días cerrados", () => {
    // Solo lunes: en una semana vista, todas las franjas caen en lunes.
    const slots = proposeSlots(input({ hours: { ...DEFAULT_WORKING_HOURS, days: [1] }, limit: 20 }));

    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.startsAt.getUTCDay()).toBe(1);
    }
  });

  it("no ofrece huecos ya ocupados", () => {
    const busy: TimeSlot[] = [
      { startsAt: new Date("2026-08-06T14:00:00.000Z"), durationMin: 60 },
      { startsAt: new Date("2026-08-06T15:00:00.000Z"), durationMin: 60 },
    ];

    const slots = proposeSlots(input({ busy }));

    expect(slots[0]?.startsAt.toISOString()).toBe("2026-08-06T16:00:00.000Z");
  });

  it("pone delante el día que pidió el cliente sin esconder el resto", () => {
    const slots = proposeSlots(
      input({ preferredDate: new Date("2026-08-07T15:00:00Z"), limit: 5 }),
    );

    const first = zonedParts(slots[0]?.startsAt ?? NOW, BOGOTA);
    expect(first.day).toBe(7);
    // Y sigue habiendo alternativas, no solo ese día.
    expect(slots.length).toBeGreaterThan(1);
  });

  it("un día lleno no deja al cliente sin opciones", () => {
    // Todo el jueves ocupado: las franjas salen del viernes en adelante.
    const busy: TimeSlot[] = Array.from({ length: 8 }, (_, index) => ({
      startsAt: new Date(`2026-08-06T${String(14 + index).padStart(2, "0")}:00:00.000Z`),
      durationMin: 60,
    }));

    const slots = proposeSlots(input({ busy, preferredDate: NOW }));

    expect(slots.length).toBeGreaterThan(0);
    expect(zonedParts(slots[0]?.startsAt ?? NOW, BOGOTA).day).toBe(7);
  });

  it("acierta al otro lado del cambio de horario de verano", () => {
    // Madrid cambia a horario de verano el 29 de marzo de 2026. Las 09:00 del
    // día 30 son las 07:00 UTC; el día 27, las 08:00 UTC. Un cálculo que use
    // un desfase fijo se equivoca en una de las dos.
    const antes = proposeSlots(
      input({
        now: new Date("2026-03-27T05:00:00Z"),
        timezone: "Europe/Madrid",
        limit: 1,
      }),
    );
    const despues = proposeSlots(
      input({
        now: new Date("2026-03-30T04:00:00Z"),
        timezone: "Europe/Madrid",
        limit: 1,
      }),
    );

    expect(antes[0]?.startsAt.toISOString()).toBe("2026-03-27T08:00:00.000Z");
    expect(despues[0]?.startsAt.toISOString()).toBe("2026-03-30T07:00:00.000Z");
  });

  it("es determinista: dos llamadas seguidas ofrecen lo mismo", () => {
    expect(proposeSlots(input())).toEqual(proposeSlots(input()));
  });
});

describe("Validación de una franja que llega de fuera", () => {
  it("acepta lo que cae en horario", () => {
    const slot: TimeSlot = { startsAt: new Date("2026-08-06T14:00:00Z"), durationMin: 60 };
    expect(isWithinWorkingHours(slot, BOGOTA, DEFAULT_WORKING_HOURS)).toBe(true);
  });

  it("rechaza la madrugada, aunque la referencia sea nuestra", () => {
    const slot: TimeSlot = { startsAt: new Date("2026-08-06T08:00:00Z"), durationMin: 60 };
    expect(isWithinWorkingHours(slot, BOGOTA, DEFAULT_WORKING_HOURS)).toBe(false);
  });

  it("rechaza el domingo", () => {
    const slot: TimeSlot = { startsAt: new Date("2026-08-09T14:00:00Z"), durationMin: 60 };
    expect(isWithinWorkingHours(slot, BOGOTA, DEFAULT_WORKING_HOURS)).toBe(false);
  });

  it("rechaza una visita que se saldría del cierre", () => {
    const slot: TimeSlot = { startsAt: new Date("2026-08-06T21:00:00Z"), durationMin: 120 };
    expect(isWithinWorkingHours(slot, BOGOTA, DEFAULT_WORKING_HOURS)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { DomainError } from "../../../../platform/errors/app-error";
import { decodeSlot, encodeSlot, slotsOverlap, type TimeSlot } from "../value-objects/time-slot";
import { Appointment, AppointmentStatus } from "./appointment";

const NOW = new Date("2026-08-06T12:00:00Z");
const SLOT: TimeSlot = { startsAt: new Date("2026-08-07T14:00:00Z"), durationMin: 60 };
const OTHER: TimeSlot = { startsAt: new Date("2026-08-08T14:00:00Z"), durationMin: 60 };

const newAppointment = (): Appointment =>
  Appointment.request({
    id: "appt-1",
    tenantId: "tenant-1",
    contactId: "contact-1",
    conversationId: "conv-1",
    propertyRef: "mock:apa-0001",
    slot: SLOT,
    now: NOW,
  });

describe("Referencia de franja — el modelo elige, no escribe fechas", () => {
  it("va y vuelve sin perder nada", () => {
    expect(decodeSlot(encodeSlot(SLOT))).toEqual(SLOT);
  });

  it("una referencia corrupta es un dato inválido, no una excepción", () => {
    expect(decodeSlot("no-es-una-referencia")).toBeNull();
    expect(decodeSlot("")).toBeNull();
    expect(decodeSlot(Buffer.from('{"s":"mañana"}').toString("base64url"))).toBeNull();
  });

  it("no es legible de un vistazo: el modelo no puede fabricarla a mano", () => {
    expect(encodeSlot(SLOT)).not.toContain("2026");
  });
});

describe("Solapes", () => {
  it("dos franjas consecutivas no se solapan", () => {
    const primera: TimeSlot = { startsAt: new Date("2026-08-07T14:00:00Z"), durationMin: 60 };
    const segunda: TimeSlot = { startsAt: new Date("2026-08-07T15:00:00Z"), durationMin: 60 };

    expect(slotsOverlap(primera, segunda)).toBe(false);
  });

  it("una franja larga pisa a la siguiente", () => {
    const larga: TimeSlot = { startsAt: new Date("2026-08-07T14:00:00Z"), durationMin: 120 };
    const siguiente: TimeSlot = { startsAt: new Date("2026-08-07T15:00:00Z"), durationMin: 60 };

    expect(slotsOverlap(larga, siguiente)).toBe(true);
  });
});

describe("Appointment — la visita acordada", () => {
  it("nace solicitada y con su rastro", () => {
    const appointment = newAppointment();

    expect(appointment.status).toBe(AppointmentStatus.REQUESTED);
    expect(appointment.isActive).toBe(true);
    expect(appointment.pullHistory().map((entry) => entry.type)).toEqual(["requested"]);
  });

  it("no se agenda en el pasado", () => {
    expect(() =>
      Appointment.request({
        id: "appt-2",
        tenantId: "tenant-1",
        contactId: "contact-1",
        conversationId: "conv-1",
        slot: { startsAt: new Date("2026-08-05T14:00:00Z"), durationMin: 60 },
        now: NOW,
      }),
    ).toThrow(DomainError);
  });

  it("se confirma y queda constancia de cuándo", () => {
    const appointment = newAppointment();
    appointment.pullHistory();

    appointment.confirm(NOW);

    expect(appointment.status).toBe(AppointmentStatus.CONFIRMED);
    expect(appointment.snapshot().confirmedAt).toEqual(NOW);
    expect(appointment.pullHistory().map((entry) => entry.type)).toEqual(["confirmed"]);
  });

  it("reprogramar conserva la cita y su historia: no es una cita nueva", () => {
    const appointment = newAppointment();
    appointment.confirm(NOW);
    appointment.pullHistory();

    appointment.reschedule(OTHER, NOW, "cliente");

    expect(appointment.id).toBe("appt-1");
    expect(appointment.scheduledAt).toEqual(OTHER.startsAt);
    expect(appointment.status).toBe(AppointmentStatus.RESCHEDULED);

    const [entry] = appointment.pullHistory();
    expect(entry?.type).toBe("rescheduled");
    expect(entry?.payload).toMatchObject({ from: SLOT.startsAt.toISOString() });
  });

  it("mover la cita vuelve a activar el recordatorio", () => {
    const appointment = newAppointment();
    appointment.markReminderSent(NOW);
    expect(appointment.reminderSentAt).toEqual(NOW);

    appointment.reschedule(OTHER, NOW);

    expect(appointment.reminderSentAt).toBeUndefined();
  });

  it("el recordatorio se manda una sola vez", () => {
    const appointment = newAppointment();

    expect(appointment.markReminderSent(NOW)).toBe(true);
    expect(appointment.markReminderSent(NOW)).toBe(false);
  });

  it("una cita cancelada no se confirma después", () => {
    const appointment = newAppointment();
    appointment.cancel(NOW, "el cliente no puede");

    expect(appointment.isActive).toBe(false);
    expect(() => {
      appointment.confirm(NOW);
    }).toThrow(DomainError);
  });

  it("una cita reprogramada sigue viva y se puede confirmar", () => {
    const appointment = newAppointment();
    appointment.reschedule(OTHER, NOW);

    appointment.confirm(NOW);
    expect(appointment.status).toBe(AppointmentStatus.CONFIRMED);
  });

  it("no se reprograma al pasado", () => {
    const appointment = newAppointment();

    expect(() => {
      appointment.reschedule({ startsAt: new Date("2026-08-01T14:00:00Z"), durationMin: 60 }, NOW);
    }).toThrow(DomainError);
  });
});

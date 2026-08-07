import { beforeEach, describe, expect, it } from "vitest";
import { isErr, isOk } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import { AppointmentStatus } from "../../domain/entities/appointment";
import { encodeSlot } from "../../domain/value-objects/time-slot";
import {
  createAppointmentHarness,
  HARNESS_TENANT,
} from "../../testing/appointment.harness";
import {
  AppointmentReminderDue,
  AppointmentRequested,
  AppointmentRescheduled,
} from "../events/appointments.events";

const CONVERSATION = "conv-1";

type Harness = ReturnType<typeof createAppointmentHarness>;

const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
  TenantContext.run({ tenantId: HARNESS_TENANT, correlationId: "test", source: "test" }, fn);

/** Franja libre número `index`, tal y como se le ofrecería al cliente. */
const offer = async (harness: Harness, index = 0): Promise<string> => {
  const proposed = await inTenant(() =>
    harness.propose.execute({ conversationId: CONVERSATION, limit: 5 }),
  );
  if (!isOk(proposed)) throw new Error("debería proponer");

  const slot = proposed.value.slots[index];
  if (!slot) throw new Error("no hay franja disponible");
  return slot.reference;
};

describe("RequestAppointment — de conversación a cita", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createAppointmentHarness();
  });

  it("agenda la franja que el cliente eligió y publica el evento", async () => {
    const reference = await offer(harness);

    const result = await inTenant(() =>
      harness.request.execute({
        conversationId: CONVERSATION,
        contactId: "contact-1",
        slotReference: reference,
        propertyRef: "mock:apa-0001",
      }),
    );

    if (!isOk(result)) throw new Error("debería agendar");
    expect(result.value.status).toBe(AppointmentStatus.REQUESTED);
    expect(result.value.scheduledAt.toISOString()).toBe("2026-08-06T14:00:00.000Z");
    // La etiqueta la escribe el formateador, no el modelo.
    expect(result.value.label).toContain("9:00");
    expect(harness.events.ofType(AppointmentRequested)).toHaveLength(1);
  });

  it("la cita hereda el asesor del lead: el cliente no estrena interlocutor", async () => {
    const reference = await offer(harness);

    const result = await inTenant(() =>
      harness.request.execute({
        conversationId: CONVERSATION,
        contactId: "contact-1",
        slotReference: reference,
      }),
    );

    if (!isOk(result)) throw new Error("debería agendar");
    expect(result.value.assignedUserId).toBe("user-1");
  });

  it("mueve el embudo del lead a través del puerto, no escribiendo en sus tablas", async () => {
    const reference = await offer(harness);

    await inTenant(() =>
      harness.request.execute({
        conversationId: CONVERSATION,
        contactId: "contact-1",
        slotReference: reference,
      }),
    );

    expect(harness.leads.scheduled).toEqual([CONVERSATION]);
  });

  it("repetir la misma solicitud no crea una segunda cita", async () => {
    const reference = await offer(harness);
    const command = {
      conversationId: CONVERSATION,
      contactId: "contact-1",
      slotReference: reference,
    };

    const first = await inTenant(() => harness.request.execute(command));
    const second = await inTenant(() => harness.request.execute(command));

    if (!isOk(first) || !isOk(second)) throw new Error("debería agendar");
    expect(second.value.id).toBe(first.value.id);
    expect(harness.events.ofType(AppointmentRequested)).toHaveLength(1);
  });

  it("«mejor el viernes» mueve la cita en vez de crear otra", async () => {
    const primera = await offer(harness);
    await inTenant(() =>
      harness.request.execute({
        conversationId: CONVERSATION,
        contactId: "contact-1",
        slotReference: primera,
      }),
    );

    const otra = await offer(harness, 1);
    const result = await inTenant(() =>
      harness.request.execute({
        conversationId: CONVERSATION,
        contactId: "contact-1",
        slotReference: otra,
      }),
    );

    if (!isOk(result)) throw new Error("debería reprogramar");
    expect(result.value.rescheduled).toBe(true);
    expect(harness.events.ofType(AppointmentRescheduled)).toHaveLength(1);
    expect(harness.events.ofType(AppointmentRequested)).toHaveLength(1);
  });

  it("rechaza una franja que se ocupó entre que se propuso y se aceptó", async () => {
    const reference = await offer(harness);

    // Otra conversación se lleva el mismo hueco por delante.
    await inTenant(() =>
      harness.request.execute({
        conversationId: "conv-2",
        contactId: "contact-2",
        slotReference: reference,
      }),
    );

    const result = await inTenant(() =>
      harness.request.execute({
        conversationId: CONVERSATION,
        contactId: "contact-1",
        slotReference: reference,
      }),
    );

    expect(isErr(result)).toBe(true);
  });

  it("rechaza una referencia inventada", async () => {
    const result = await inTenant(() =>
      harness.request.execute({
        conversationId: CONVERSATION,
        contactId: "contact-1",
        slotReference: "el-jueves-a-las-tres",
      }),
    );

    expect(isErr(result)).toBe(true);
  });

  it("rechaza una franja fuera de horario aunque venga bien codificada", async () => {
    // Domingo de madrugada, codificado con nuestro propio formato: la
    // referencia es legible y aun así no vale.
    const reference = encodeSlot({
      startsAt: new Date("2026-08-09T08:00:00Z"),
      durationMin: 60,
    });

    const result = await inTenant(() =>
      harness.request.execute({
        conversationId: CONVERSATION,
        contactId: "contact-1",
        slotReference: reference,
      }),
    );

    expect(isErr(result)).toBe(true);
  });

  it("rechaza una franja del pasado", async () => {
    const reference = encodeSlot({
      startsAt: new Date("2026-08-05T14:00:00Z"),
      durationMin: 60,
    });

    const result = await inTenant(() =>
      harness.request.execute({
        conversationId: CONVERSATION,
        contactId: "contact-1",
        slotReference: reference,
      }),
    );

    expect(isErr(result)).toBe(true);
  });

  it("las franjas ya agendadas dejan de ofrecerse", async () => {
    const reference = await offer(harness);
    await inTenant(() =>
      harness.request.execute({
        conversationId: CONVERSATION,
        contactId: "contact-1",
        slotReference: reference,
      }),
    );

    const proposed = await inTenant(() =>
      harness.propose.execute({ conversationId: "conv-3" }),
    );

    if (!isOk(proposed)) throw new Error("debería proponer");
    expect(proposed.value.slots[0]?.reference).not.toBe(reference);
  });
});

describe("Recordatorios — avisar una vez, y solo una", () => {
  it("encola el recordatorio de una visita dentro de la ventana", async () => {
    const harness = createAppointmentHarness();
    const slotReference = await offer(harness);
    await inTenant(() =>
      harness.request.execute({
        conversationId: CONVERSATION,
        contactId: "contact-1",
        slotReference,
      }),
    );

    const sent = await inTenant(() => harness.scanReminders.execute());

    expect(sent).toBe(1);
    expect(harness.events.ofType(AppointmentReminderDue)).toHaveLength(1);
  });

  it("una segunda pasada no vuelve a avisar", async () => {
    const harness = createAppointmentHarness();
    const slotReference = await offer(harness);
    await inTenant(() =>
      harness.request.execute({
        conversationId: CONVERSATION,
        contactId: "contact-1",
        slotReference,
      }),
    );

    await inTenant(() => harness.scanReminders.execute());
    const second = await inTenant(() => harness.scanReminders.execute());

    expect(second).toBe(0);
    expect(harness.events.ofType(AppointmentReminderDue)).toHaveLength(1);
  });

  it("una cita cancelada no genera recordatorio", async () => {
    const harness = createAppointmentHarness();
    const slotReference = await offer(harness);
    const requested = await inTenant(() =>
      harness.request.execute({
        conversationId: CONVERSATION,
        contactId: "contact-1",
        slotReference,
      }),
    );
    if (!isOk(requested)) throw new Error("debería agendar");

    const appointment = await inTenant(() => harness.appointments.findById(requested.value.id));
    appointment?.cancel(harness.clock.now(), "el cliente no puede");
    if (appointment) await inTenant(() => harness.appointments.save(appointment));

    expect(await inTenant(() => harness.scanReminders.execute())).toBe(0);
  });
});

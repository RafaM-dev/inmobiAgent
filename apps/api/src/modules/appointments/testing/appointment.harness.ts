import { FixedClock } from "../../../platform/clock/clock";
import { RecordingEventPublisher } from "../../../platform/events/event-publisher";
import { NoopLogger } from "../../../platform/logging/logger";
import { ok, okVoid, type Result } from "../../../platform/result/result";
import type { TenantDirectory, TenantView } from "../../identity";
import type { CaptureLeadCommand, LeadService, LeadView } from "../../leads";
import { createInMemoryAppointments } from "./in-memory-appointments";

/**
 * Banco de pruebas de la agenda.
 *
 * Monta los casos de uso REALES sobre el calendario interno real. Lo único
 * simulado es lo que pertenece a otros módulos —el directorio de tenants y el
 * puerto de leads—, porque probar `appointments` no debe requerir levantar
 * `identity` ni `leads`.
 */

export const HARNESS_TENANT = "tenant-1";

/** Jueves 6 de agosto de 2026, 07:00 en Bogotá. */
export const HARNESS_NOW = new Date("2026-08-06T12:00:00Z");

const TENANT_VIEW: TenantView = {
  id: HARNESS_TENANT,
  slug: "demo",
  name: "Inmobiliaria Demo",
  status: "ACTIVE",
  plan: "PRO",
  locale: "es-CO",
  timezone: "America/Bogota",
  currency: "COP",
  settings: { agentDisplayName: "Sofía", tone: "CERCANO", maxConsecutiveFailedTurns: 2 },
};

export class FakeTenantDirectory implements TenantDirectory {
  findById(): Promise<TenantView | null> {
    return Promise.resolve(TENANT_VIEW);
  }
  findBySlug(): Promise<TenantView | null> {
    return Promise.resolve(TENANT_VIEW);
  }
  requireActive(): Promise<TenantView> {
    return Promise.resolve(TENANT_VIEW);
  }
}

/** Doble del puerto de leads: registra las llamadas y no decide nada. */
export class FakeLeadService implements LeadService {
  readonly scheduled: string[] = [];
  captured = 0;

  capture(command: CaptureLeadCommand): Promise<Result<LeadView, never>> {
    void command;
    this.captured += 1;
    return Promise.resolve(
      ok({
        id: "lead-1",
        status: "QUALIFIED" as const,
        score: 62,
        band: "WARM" as const,
        assignedUserId: "user-1",
        interestCount: 2,
        created: this.captured === 1,
      }),
    );
  }

  findByConversation(): Promise<Result<LeadView | null, never>> {
    return Promise.resolve(ok(null));
  }

  markScheduled(conversationId: string): Promise<Result<void, never>> {
    this.scheduled.push(conversationId);
    return Promise.resolve(okVoid());
  }
}

export const createAppointmentHarness = (now: Date = HARNESS_NOW) => {
  const events = new RecordingEventPublisher();
  const leads = new FakeLeadService();
  const clock = new FixedClock(now);

  const appointments = createInMemoryAppointments({
    tenants: new FakeTenantDirectory(),
    leads,
    events,
    clock,
    logger: new NoopLogger(),
  });

  return {
    appointments: appointments.repository,
    service: appointments.service,
    scanReminders: appointments.scanReminders,
    events,
    leads,
    clock,
    /** Atajos usados por los tests, con la forma de los casos de uso. */
    propose: { execute: appointments.service.proposeSlots.bind(appointments.service) },
    request: { execute: appointments.service.request.bind(appointments.service) },
  };
};

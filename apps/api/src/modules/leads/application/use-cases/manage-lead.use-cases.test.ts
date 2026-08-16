import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../../platform/clock/clock";
import { NoopUnitOfWork } from "../../../../platform/database/unit-of-work";
import { ErrorCode } from "../../../../platform/errors/error-codes";
import { RecordingEventPublisher } from "../../../../platform/events/event-publisher";
import { isErr, isOk } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import type { AdvisorDirectory, AdvisorView } from "../../../identity";
import { Lead, LeadStatus } from "../../domain/entities/lead";
import { InMemoryLeadRepository } from "../../testing/in-memory-lead.repository";
import { LeadAssigned, LeadStatusChanged } from "../events/leads.events";
import { AssignLeadUseCase, ChangeLeadStatusUseCase } from "./manage-lead.use-cases";

const NOW = new Date("2026-08-16T15:00:00Z");
const TENANT = "tenant-1";

class FakeAdvisors implements AdvisorDirectory {
  constructor(private readonly advisors: AdvisorView[] = []) {}

  listAssignable(): Promise<readonly AdvisorView[]> {
    return Promise.resolve(this.advisors);
  }

  findById(userId: string): Promise<AdvisorView | null> {
    return Promise.resolve(this.advisors.find((a) => a.id === userId) ?? null);
  }
}

const advisor = (id: string): AdvisorView => ({ id, displayName: id, email: `${id}@demo.co` });

const build = (advisors: AdvisorView[] = [advisor("user-1")]) => {
  const leads = new InMemoryLeadRepository();
  const events = new RecordingEventPublisher();
  const deps = {
    leads,
    unitOfWork: new NoopUnitOfWork(),
    events,
    clock: new FixedClock(NOW),
  };

  return {
    leads,
    events,
    changeStatus: new ChangeLeadStatusUseCase(deps),
    assign: new AssignLeadUseCase({ ...deps, advisors: new FakeAdvisors(advisors) }),
  };
};

const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
  TenantContext.run({ tenantId: TENANT, correlationId: "test", source: "test" }, fn);

/** Un lead recién capturado, ya guardado y con el historial de captura vaciado. */
const seed = async (leads: InMemoryLeadRepository): Promise<Lead> => {
  const lead = Lead.capture({
    id: "lead-1",
    tenantId: TENANT,
    contactId: "contact-1",
    conversationId: "conv-1",
    source: "whatsapp",
    now: NOW,
  });
  await leads.save(lead);
  leads.history.length = 0;
  return lead;
};

describe("ChangeLeadStatus — mover el embudo desde el panel", () => {
  let harness: ReturnType<typeof build>;

  beforeEach(async () => {
    harness = build();
    await inTenant(() => seed(harness.leads));
  });

  it("avanza el lead, deja rastro y publica el cambio", async () => {
    const result = await inTenant(() =>
      harness.changeStatus.execute({ leadId: "lead-1", status: LeadStatus.CONTACTED }),
    );

    if (!isOk(result)) throw new Error("debería avanzar");
    expect(result.value.status).toBe(LeadStatus.CONTACTED);

    const published = harness.events.ofType(LeadStatusChanged);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ from: LeadStatus.NEW, to: LeadStatus.CONTACTED });

    expect(harness.leads.history.map((entry) => entry.type)).toEqual(["status_changed"]);
  });

  it("guarda el motivo en el histórico cuando se cierra", async () => {
    await inTenant(() =>
      harness.changeStatus.execute({
        leadId: "lead-1",
        status: LeadStatus.LOST,
        reason: "Se fue con la competencia",
      }),
    );

    expect(harness.leads.history[0]?.payload).toMatchObject({
      to: LeadStatus.LOST,
      reason: "Se fue con la competencia",
    });
  });

  /*
   * Es LA razón de que este caso de uso valide en vez de dejar lanzar al
   * agregado. Dos asesores con el panel abierto: uno cierra el lead, el otro
   * intenta moverlo desde una pantalla de hace diez minutos. No es un bug, es
   * una carrera entre personas, y merece un 409 que se pueda explicar.
   */
  it("rechaza con conflicto una transición imposible, sin romperse", async () => {
    await inTenant(() =>
      harness.changeStatus.execute({ leadId: "lead-1", status: LeadStatus.LOST }),
    );
    harness.events.published.length = 0;

    const result = await inTenant(() =>
      harness.changeStatus.execute({ leadId: "lead-1", status: LeadStatus.WON }),
    );

    if (!isErr(result)) throw new Error("no debería dejar reabrir un lead perdido");
    expect(result.error.code).toBe(ErrorCode.CONFLICT);
    expect(result.error.httpStatus).toBe(409);

    // Y el lead sigue donde estaba: un rechazo no puede dejar rastro.
    const lead = await inTenant(() => harness.leads.findById("lead-1"));
    expect(lead?.status).toBe(LeadStatus.LOST);
    expect(harness.events.published).toHaveLength(0);
  });

  it("no hace nada si ya está en ese estado: es un doble clic, no un error", async () => {
    const result = await inTenant(() =>
      harness.changeStatus.execute({ leadId: "lead-1", status: LeadStatus.NEW }),
    );

    expect(isOk(result)).toBe(true);
    expect(harness.leads.history).toHaveLength(0);
    expect(harness.events.published).toHaveLength(0);
  });

  it("devuelve 404 si el lead no existe", async () => {
    const result = await inTenant(() =>
      harness.changeStatus.execute({ leadId: "no-existe", status: LeadStatus.CONTACTED }),
    );

    if (!isErr(result)) throw new Error("debería fallar");
    expect(result.error.httpStatus).toBe(404);
  });
});

describe("AssignLead — quién lleva el lead", () => {
  let harness: ReturnType<typeof build>;

  beforeEach(async () => {
    harness = build();
    await inTenant(() => seed(harness.leads));
  });

  it("asigna a un asesor del equipo y lo anuncia", async () => {
    const result = await inTenant(() =>
      harness.assign.execute({ leadId: "lead-1", userId: "user-1" }),
    );

    if (!isOk(result)) throw new Error("debería asignar");
    expect(result.value.assignedUserId).toBe("user-1");
    expect(harness.events.ofType(LeadAssigned)).toHaveLength(1);
  });

  /*
   * El identificador llega por HTTP, así que puede ser cualquier cosa: un
   * usuario desactivado, uno de otra inmobiliaria, o basura. Sin esta
   * comprobación el lead quedaría asignado a un fantasma —invisible en el
   * "míos" de todos y trabajado por nadie—, que es la peor forma de perderlo.
   */
  it("no asigna a quien no está en el directorio de asesores", async () => {
    const result = await inTenant(() =>
      harness.assign.execute({ leadId: "lead-1", userId: "usuario-de-otra-parte" }),
    );

    if (!isErr(result)) throw new Error("no debería asignar a un desconocido");
    expect(result.error.code).toBe(ErrorCode.VALIDATION);

    const lead = await inTenant(() => harness.leads.findById("lead-1"));
    expect(lead?.assignedUserId).toBeUndefined();
  });

  it("devuelve el lead al montón sin inventarse un evento que nadie escucha", async () => {
    await inTenant(() => harness.assign.execute({ leadId: "lead-1", userId: "user-1" }));
    harness.events.published.length = 0;

    const result = await inTenant(() =>
      harness.assign.execute({ leadId: "lead-1", userId: null }),
    );

    if (!isOk(result)) throw new Error("debería desasignar");
    expect(result.value.assignedUserId).toBeUndefined();
    expect(harness.events.published).toHaveLength(0);
    expect(harness.leads.history.at(-1)).toMatchObject({
      type: "unassigned",
      payload: { previousUserId: "user-1" },
    });
  });

  it("asignar dos veces a la misma persona no duplica el aviso", async () => {
    await inTenant(() => harness.assign.execute({ leadId: "lead-1", userId: "user-1" }));
    await inTenant(() => harness.assign.execute({ leadId: "lead-1", userId: "user-1" }));

    expect(harness.events.ofType(LeadAssigned)).toHaveLength(1);
  });
});

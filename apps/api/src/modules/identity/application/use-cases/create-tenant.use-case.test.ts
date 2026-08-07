import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../../platform/clock/clock";
import { NoopUnitOfWork } from "../../../../platform/database/unit-of-work";
import { RecordingEventPublisher } from "../../../../platform/events/event-publisher";
import { SequentialIdGenerator } from "../../../../platform/ids/id-generator";
import { isErr, isOk } from "../../../../platform/result/result";
import { UserRole } from "../../domain/entities/user";
import {
  InMemoryTenantRepository,
  InMemoryUserRepository,
} from "../../testing/in-memory-identity.repositories";
import { TenantCreated } from "../events/identity.events";
import { CreateTenantUseCase } from "./create-tenant.use-case";

const setup = () => {
  const tenants = new InMemoryTenantRepository();
  const users = new InMemoryUserRepository();
  const events = new RecordingEventPublisher();

  const useCase = new CreateTenantUseCase({
    tenants,
    users,
    unitOfWork: new NoopUnitOfWork(),
    events,
    clock: new FixedClock(new Date("2026-02-01T12:00:00.000Z")),
    ids: new SequentialIdGenerator("id"),
  });

  return { useCase, tenants, users, events };
};

describe("CreateTenantUseCase", () => {
  it("crea el tenant, su propietario y publica TenantCreated", async () => {
    const { useCase, users, events } = setup();

    const result = await useCase.execute({
      slug: "inmobiliaria-laureles",
      name: "Inmobiliaria Laureles",
      owner: { email: "Ana@Laureles.co", displayName: "Ana Restrepo" },
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    expect(result.value.slug).toBe("inmobiliaria-laureles");
    expect(result.value.settings.agentDisplayName).toBe("Asistente");

    const owner = await users.findByEmail("ana@laureles.co");
    expect(owner?.role).toBe(UserRole.OWNER);
    expect(owner?.canReceiveConversations).toBe(true);

    const published = events.ofType(TenantCreated);
    expect(published).toHaveLength(1);
    expect(published[0]?.slug).toBe("inmobiliaria-laureles");
  });

  it("rechaza un slug repetido sin lanzar excepción", async () => {
    const { useCase } = setup();
    const input = { slug: "duplicada", name: "Inmobiliaria Duplicada" };

    await useCase.execute(input);
    const second = await useCase.execute(input);

    expect(isErr(second)).toBe(true);
    if (!isErr(second)) return;
    expect(second.error.code).toBe("CONFLICT");
    expect(second.error.httpStatus).toBe(409);
  });

  it("devuelve un error de validación con el detalle del campo", async () => {
    const { useCase, tenants, events } = setup();

    const result = await useCase.execute({ slug: "ok", name: "X" });

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.code).toBe("VALIDATION");
    expect(result.error.details?.map((d) => d.path)).toContain("name");
    // Nada persistido, nada publicado.
    expect(tenants.items.size).toBe(0);
    expect(events.published).toHaveLength(0);
  });

  it("un tenant sin propietario es válido (alta desde el CLI de operaciones)", async () => {
    const { useCase, users } = setup();

    const result = await useCase.execute({ slug: "sin-dueno", name: "Sin dueño todavía" });

    expect(isOk(result)).toBe(true);
    expect(await users.listByTenant()).toHaveLength(0);
  });
});

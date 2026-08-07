import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../../platform/clock/clock";
import { hashPassword } from "../../../../platform/crypto/password";
import { NoopUnitOfWork } from "../../../../platform/database/unit-of-work";
import { SequentialIdGenerator } from "../../../../platform/ids/id-generator";
import { NoopLogger } from "../../../../platform/logging/logger";
import { isErr, isOk } from "../../../../platform/result/result";
import { Tenant } from "../../domain/entities/tenant";
import { User, UserRole, UserStatus } from "../../domain/entities/user";
import {
  InMemorySessionRepository,
  InMemoryTenantRepository,
  InMemoryUserRepository,
} from "../../testing/in-memory-identity.repositories";
import { TenantSettings } from "../../domain/value-objects/tenant-settings";
import { SESSION_TTL_MS, SessionServiceImpl } from "./session.service";

const NOW = new Date("2026-08-07T09:00:00Z");
const PASSWORD = "contraseña-de-prueba";

const build = async () => {
  const tenants = new InMemoryTenantRepository();
  const users = new InMemoryUserRepository();
  const sessions = new InMemorySessionRepository();
  const clock = new FixedClock(NOW);

  const tenant = Tenant.create({
    id: "t1",
    slug: "inmobiliaria-demo",
    name: "Inmobiliaria Demo",
    settings: TenantSettings.create({}),
    now: NOW,
  });
  await tenants.save(tenant);

  const user = User.create({
    id: "u1",
    tenantId: "t1",
    email: "asesor@demo.co",
    displayName: "Asesor Demo",
    role: UserRole.OWNER,
    status: UserStatus.ACTIVE,
    now: NOW,
  });
  user.setPasswordHash(await hashPassword(PASSWORD), NOW);
  await users.save(user);

  // El propietario no se puede desactivar (regla de F1), así que las pruebas de
  // usuario desactivado necesitan un asesor normal.
  const agent = User.create({
    id: "u3",
    tenantId: "t1",
    email: "agente@demo.co",
    displayName: "Agente",
    role: UserRole.AGENT,
    status: UserStatus.ACTIVE,
    now: NOW,
  });
  agent.setPasswordHash(await hashPassword(PASSWORD), NOW);
  await users.save(agent);

  const service = new SessionServiceImpl({
    users,
    tenants,
    sessions,
    unitOfWork: new NoopUnitOfWork(),
    clock,
    ids: new SequentialIdGenerator("ses"),
    logger: new NoopLogger(),
  });

  return { service, tenants, users, sessions, clock, tenant, user };
};

const login = async (
  harness: Awaited<ReturnType<typeof build>>,
  overrides: { email?: string; password?: string; tenantSlug?: string } = {},
) =>
  harness.service.login({
    tenantSlug: overrides.tenantSlug ?? "inmobiliaria-demo",
    email: overrides.email ?? "asesor@demo.co",
    password: overrides.password ?? PASSWORD,
  });

describe("Acceso al back-office", () => {
  let harness: Awaited<ReturnType<typeof build>>;

  beforeEach(async () => {
    harness = await build();
  });

  it("entra con credenciales correctas y devuelve el token una sola vez", async () => {
    const result = await login(harness);

    if (!isOk(result)) throw new Error("debería entrar");
    expect(result.value.user.userId).toBe("u1");
    expect(result.value.user.tenantId).toBe("t1");
    expect(result.value.token.length).toBeGreaterThan(20);
    expect(result.value.expiresAt.getTime()).toBe(NOW.getTime() + SESSION_TTL_MS);
  });

  it("el token NO se guarda en claro: en la base solo vive su huella", async () => {
    const result = await login(harness);
    if (!isOk(result)) throw new Error("debería entrar");

    const stored = [...harness.sessions.items.values()][0]?.snapshot();
    expect(stored?.tokenHash).toBeDefined();
    expect(stored?.tokenHash).not.toBe(result.value.token);
  });

  it("rechaza la contraseña incorrecta", async () => {
    expect(isErr(await login(harness, { password: "otra-cosa" }))).toBe(true);
  });

  it("un correo inexistente falla igual que una contraseña incorrecta", async () => {
    const inexistente = await login(harness, { email: "nadie@demo.co" });
    const incorrecta = await login(harness, { password: "mal" });

    // Mismo mensaje: el formulario no puede ser un directorio de quién trabaja
    // en cada inmobiliaria.
    expect(isErr(inexistente) && isErr(incorrecta)).toBe(true);
    if (isErr(inexistente) && isErr(incorrecta)) {
      expect(inexistente.error.message).toBe(incorrecta.error.message);
    }
  });

  it("una inmobiliaria inexistente falla igual", async () => {
    expect(isErr(await login(harness, { tenantSlug: "no-existe" }))).toBe(true);
  });

  it("un usuario sin contraseña no entra aunque exista", async () => {
    const invitado = User.create({
      id: "u2",
      tenantId: "t1",
      email: "invitado@demo.co",
      displayName: "Invitado",
      now: NOW,
    });
    await harness.users.save(invitado);

    expect(isErr(await login(harness, { email: "invitado@demo.co" }))).toBe(true);
  });

  it("un usuario desactivado no entra aunque acierte la contraseña", async () => {
    const agente = await harness.users.findById("u3");
    agente?.disable(NOW);
    if (agente) await harness.users.save(agente);

    expect(isErr(await login(harness, { email: "agente@demo.co" }))).toBe(true);
  });

  it("un tenant suspendido no deja entrar a nadie", async () => {
    const tenant = await harness.tenants.findBySlug("inmobiliaria-demo");
    tenant?.suspend(NOW);
    if (tenant) await harness.tenants.save(tenant);

    expect(isErr(await login(harness))).toBe(true);
  });
});

describe("Validación de sesión", () => {
  let harness: Awaited<ReturnType<typeof build>>;

  beforeEach(async () => {
    harness = await build();
  });

  it("un token válido identifica al usuario y su inmobiliaria", async () => {
    const entrada = await login(harness);
    if (!isOk(entrada)) throw new Error("debería entrar");

    const authenticated = await harness.service.authenticate(entrada.value.token);

    if (!isOk(authenticated)) throw new Error("debería autenticar");
    expect(authenticated.value.tenantId).toBe("t1");
    expect(authenticated.value.email).toBe("asesor@demo.co");
  });

  it("un token inventado no vale", async () => {
    expect(isErr(await harness.service.authenticate("token-inventado"))).toBe(true);
    expect(isErr(await harness.service.authenticate(""))).toBe(true);
  });

  it("una sesión caducada no vale", async () => {
    const entrada = await login(harness);
    if (!isOk(entrada)) throw new Error("debería entrar");

    harness.clock.set(new Date(NOW.getTime() + SESSION_TTL_MS + 1000));

    expect(isErr(await harness.service.authenticate(entrada.value.token))).toBe(true);
  });

  it("desactivar a alguien lo echa en la siguiente petición", async () => {
    const entrada = await login(harness, { email: "agente@demo.co" });
    if (!isOk(entrada)) throw new Error("debería entrar");

    const agente = await harness.users.findById("u3");
    agente?.disable(NOW);
    if (agente) await harness.users.save(agente);

    // La sesión sigue viva en la tabla, pero el estado del usuario manda.
    expect(isErr(await harness.service.authenticate(entrada.value.token))).toBe(true);
  });

  it("la sesión se prorroga con la actividad, no de golpe", async () => {
    const entrada = await login(harness);
    if (!isOk(entrada)) throw new Error("debería entrar");

    // Antes de la mitad de vida no se toca la caducidad: así no se escribe en
    // la base en cada petición del inbox.
    harness.clock.set(new Date(NOW.getTime() + 1000));
    await harness.service.authenticate(entrada.value.token);
    const sinProrroga = [...harness.sessions.items.values()][0]?.expiresAt;
    expect(sinProrroga?.getTime()).toBe(NOW.getTime() + SESSION_TTL_MS);

    // Pasada la mitad, sí.
    harness.clock.set(new Date(NOW.getTime() + SESSION_TTL_MS * 0.75));
    await harness.service.authenticate(entrada.value.token);
    const prorrogada = [...harness.sessions.items.values()][0]?.expiresAt;
    expect(prorrogada?.getTime()).toBeGreaterThan(NOW.getTime() + SESSION_TTL_MS);
  });

  it("cerrar sesión la invalida de inmediato", async () => {
    const entrada = await login(harness);
    if (!isOk(entrada)) throw new Error("debería entrar");

    await harness.service.logout(entrada.value.token);

    // Ésta es la razón de no usar JWT: se puede revocar de verdad.
    expect(isErr(await harness.service.authenticate(entrada.value.token))).toBe(true);
  });

  it("cerrar una sesión que no existe no falla", async () => {
    expect(isOk(await harness.service.logout("token-cualquiera"))).toBe(true);
  });
});

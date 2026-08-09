import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../../platform/clock/clock";
import { NotFoundError, UpstreamError, type AppError } from "../../../../platform/errors/app-error";
import { SequentialIdGenerator } from "../../../../platform/ids/id-generator";
import { NoopLogger } from "../../../../platform/logging/logger";
import { err, isErr, isOk, ok, okVoid, type Result } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import { ChannelAccount } from "../../domain/entities/channel-account";
import type { ChannelAccountRepository } from "../../domain/repositories/channel-account.repository";
import { defaultCapabilities } from "../../domain/value-objects/channel-capabilities";
import { ChannelType } from "../../domain/value-objects/channel-type";
import type { InboundMessage } from "../../domain/value-objects/inbound-message";
import type { ChannelCredentials } from "../ports/channel-credentials";
import type {
  ChannelRegistry,
  ChatChannel,
  DeliveryReceipt,
  DeliveryStatusUpdate,
} from "../ports/chat-channel";
import { ConnectChannelAccountUseCase } from "./connect-channel-account.use-case";
import { RegisterChannelAccountUseCase } from "./register-channel-account.use-case";

/**
 * Lo que se prueba aquí es la decisión D80: comprobar las credenciales informa,
 * NO bloquea. Es la parte del comportamiento que a nadie se le ocurriría
 * mirando el código y que un refactor bienintencionado —"si no verifica, no
 * guardes"— rompería dejando el producto sin forma de conectar WhatsApp cuando
 * Meta tenga un mal día.
 */

const NOW = new Date("2026-08-09T10:00:00Z");
const TENANT = "tenant-1";

class InMemoryAccounts implements ChannelAccountRepository {
  readonly rows = new Map<string, ChannelAccount>();

  findById(id: string): Promise<ChannelAccount | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  findByExternalId(channelType: ChannelType, externalId: string): Promise<ChannelAccount | null> {
    const found = [...this.rows.values()].find(
      (row) => row.channelType === channelType && row.externalId === externalId,
    );
    return Promise.resolve(found ?? null);
  }

  listByTenant(tenantId: string): Promise<ChannelAccount[]> {
    return Promise.resolve([...this.rows.values()].filter((row) => row.tenantId === tenantId));
  }

  save(account: ChannelAccount): Promise<void> {
    this.rows.set(account.id, account);
    return Promise.resolve();
  }
}

class InMemoryCredentials implements ChannelCredentials {
  readonly stored = new Map<string, Readonly<Record<string, string>>>();
  failing = false;

  get(accountId: string): Promise<Result<Readonly<Record<string, string>>, AppError>> {
    const found = this.stored.get(accountId);
    return Promise.resolve(found ? ok(found) : err(new NotFoundError("Credenciales", accountId)));
  }

  set(
    accountId: string,
    credentials: Readonly<Record<string, string>>,
  ): Promise<Result<void, AppError>> {
    if (this.failing) return Promise.resolve(err(new NotFoundError("Cuenta", accountId)));
    this.stored.set(accountId, credentials);
    return Promise.resolve(okVoid());
  }
}

/** Canal mínimo; solo importa si sabe verificar y qué contesta. */
class FakeChannel implements ChatChannel {
  readonly type = ChannelType.WHATSAPP;
  readonly seen: Readonly<Record<string, string>>[] = [];
  rejection: AppError | undefined;

  capabilities() {
    return defaultCapabilities();
  }

  normalizeInbound(): Result<readonly InboundMessage[], AppError> {
    return ok([]);
  }

  normalizeStatuses(): readonly DeliveryStatusUpdate[] {
    return [];
  }

  send(): Promise<Result<DeliveryReceipt, AppError>> {
    return Promise.resolve(ok({ deliveredAt: NOW }));
  }

  verifyCredentials(input: {
    credentials: Readonly<Record<string, string>>;
  }): Promise<Result<void, AppError>> {
    this.seen.push(input.credentials);
    return Promise.resolve(this.rejection ? err(this.rejection) : okVoid());
  }
}

/**
 * Canal SIN el método de verificación, como la consola.
 *
 * Es una clase aparte y no una bandera porque lo que ejerce el caso de uso es
 * la AUSENCIA de la propiedad: un `verifyCredentials` puesto a `undefined`
 * probaría otra cosa.
 */
class UnverifiableChannel implements ChatChannel {
  readonly type = ChannelType.WHATSAPP;

  capabilities() {
    return defaultCapabilities();
  }

  normalizeInbound(): Result<readonly InboundMessage[], AppError> {
    return ok([]);
  }

  normalizeStatuses(): readonly DeliveryStatusUpdate[] {
    return [];
  }

  send(): Promise<Result<DeliveryReceipt, AppError>> {
    return Promise.resolve(ok({ deliveredAt: NOW }));
  }
}

class FakeRegistry implements ChannelRegistry {
  constructor(private readonly channels: readonly ChatChannel[]) {}

  get(type: ChannelType): ChatChannel | undefined {
    return this.channels.find((channel) => channel.type === type);
  }

  require(type: ChannelType): ChatChannel {
    const found = this.get(type);
    if (!found) throw new Error(`Canal no registrado: ${type}`);
    return found;
  }

  available(): readonly ChannelType[] {
    return this.channels.map((channel) => channel.type);
  }
}

const COMMAND = {
  channelType: ChannelType.WHATSAPP,
  externalId: "1234567890",
  displayName: "Línea principal",
  credentials: { accessToken: "EAAG-token" },
};

describe("Conectar una cuenta de canal", () => {
  let accounts: InMemoryAccounts;
  let credentials: InMemoryCredentials;
  let channel: FakeChannel;

  const build = (options: { registered?: readonly ChatChannel[] } = {}) =>
    new ConnectChannelAccountUseCase({
      register: new RegisterChannelAccountUseCase({
        accounts,
        clock: new FixedClock(NOW),
        ids: new SequentialIdGenerator("acc"),
      }),
      accounts,
      channels: new FakeRegistry(options.registered ?? [channel]),
      credentials,
      logger: new NoopLogger(),
    });

  const connect = (useCase: ConnectChannelAccountUseCase, overrides: Partial<typeof COMMAND> = {}) =>
    TenantContext.run({ tenantId: TENANT, correlationId: "c-1", source: "test" }, () =>
      useCase.execute({ ...COMMAND, ...overrides }),
    );

  beforeEach(() => {
    accounts = new InMemoryAccounts();
    credentials = new InMemoryCredentials();
    channel = new FakeChannel();
  });

  it("da de alta la cuenta y guarda el token", async () => {
    const result = await connect(build());

    if (!isOk(result)) throw new Error("debería conectar");
    expect(result.value.verified).toBe(true);
    expect(result.value.account.externalId).toBe("1234567890");
    expect(credentials.stored.get(result.value.account.id)).toEqual({ accessToken: "EAAG-token" });
  });

  it("GUARDA IGUAL cuando el proveedor no confirma, y lo dice", async () => {
    // D80. Si esto se volviera bloqueante, una caída de Meta impediría conectar
    // WhatsApp y no habría manera de saltárselo desde el producto.
    channel.rejection = new UpstreamError("whatsapp", "unavailable");

    const result = await connect(build());

    if (!isOk(result)) throw new Error("debería conectar de todos modos");
    expect(result.value.verified).toBe(false);
    expect(result.value.verificationMessage).toBeDefined();
    expect(credentials.stored.size).toBe(1);
  });

  it("un canal que no sabe verificar no se da por verificado", async () => {
    const result = await connect(build({ registered: [new UnverifiableChannel()] }));

    if (!isOk(result)) throw new Error("debería conectar");
    expect(result.value.verified).toBe(false);
  });

  it("rotar el token comprueba el NUEVO y reemplaza al viejo, sin duplicar la cuenta", async () => {
    const useCase = build();
    await connect(useCase);

    const segundo = await connect(useCase, { credentials: { accessToken: "EAAG-rotado" } });

    if (!isOk(segundo)) throw new Error("debería conectar");
    // Se comprobó lo que se acaba de escribir, no lo que ya estaba guardado.
    expect(channel.seen.map((c) => c["accessToken"])).toEqual(["EAAG-token", "EAAG-rotado"]);
    // Idempotente: sigue siendo UNA cuenta, con el token nuevo.
    expect(accounts.rows.size).toBe(1);
    expect(credentials.stored.get(segundo.value.account.id)).toEqual({
      accessToken: "EAAG-rotado",
    });
  });

  it("rechaza un canal que este despliegue no sabe operar", async () => {
    // Sin la app de Meta configurada, WhatsApp no está en el registro (D31).
    const result = await connect(build({ registered: [] }));

    expect(isErr(result)).toBe(true);
    expect(accounts.rows.size).toBe(0);
  });

  it("no deja la cuenta creada sin credenciales si el cifrado falla", async () => {
    credentials.failing = true;

    const result = await connect(build());

    expect(isErr(result)).toBe(true);
  });

  it("el número de otra inmobiliaria es un conflicto, no un alta", async () => {
    accounts.rows.set(
      "ajena",
      ChannelAccount.create({
        id: "ajena",
        tenantId: "otro-tenant",
        channelType: ChannelType.WHATSAPP,
        externalId: "1234567890",
        displayName: "De otra",
        now: NOW,
      }),
    );

    const result = await connect(build());

    expect(isErr(result)).toBe(true);
    expect(credentials.stored.size).toBe(0);
  });
});

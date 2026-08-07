import type { Database } from "../../../../../platform/database/prisma";
import type { SecretBox } from "../../../../../platform/crypto/secret-box";
import { NotFoundError, type AppError } from "../../../../../platform/errors/app-error";
import { err, okVoid, type Result } from "../../../../../platform/result/result";
import type { ChannelCredentials } from "../../../application/ports/channel-credentials";

/**
 * Credenciales cifradas en `channel_accounts.credentials`.
 *
 * NO se filtra por `tenantScope()` y es una decisión: esto lo usa un adaptador
 * que ya recibió la cuenta resuelta por el webhook, en un punto donde todavía
 * puede no haber contexto de tenant. La comprobación de pertenencia la hace
 * quien resuelve la cuenta —`ReceiveInboundMessage` y `DispatchReply`, ambos con
 * `assertSameTenant`—, y aquí solo se busca por clave primaria.
 */
export class PrismaChannelCredentials implements ChannelCredentials {
  constructor(
    private readonly db: Database,
    private readonly secrets: SecretBox,
  ) {}

  async get(accountId: string): Promise<Result<Readonly<Record<string, string>>, AppError>> {
    const row = await this.db.client().channelAccount.findUnique({
      where: { id: accountId },
      select: { credentials: true },
    });

    if (!row?.credentials) {
      return err(new NotFoundError("Credenciales de la cuenta de canal", accountId));
    }

    return this.secrets.decryptJson(Buffer.from(row.credentials));
  }

  async set(
    accountId: string,
    credentials: Readonly<Record<string, string>>,
  ): Promise<Result<void, AppError>> {
    // Prisma tipa `Bytes` como `Uint8Array<ArrayBuffer>`; el `Buffer` de Node
    // lo es en la práctica, pero su tipo admite además `SharedArrayBuffer`.
    const blob = new Uint8Array(this.secrets.encryptJson(credentials));

    await this.db.client().channelAccount.update({
      where: { id: accountId },
      data: { credentials: blob },
    });

    return okVoid();
  }
}

import type { AppError } from "../../../../platform/errors/app-error";
import type { Result } from "../../../../platform/result/result";

/**
 * PUERTO `ChannelCredentials` — los secretos de una cuenta de canal.
 *
 * Van aparte de `ChannelAccountView` a propósito. La vista de la cuenta circula
 * por casos de uso, rutas y trazas; los secretos solo los pide el adaptador que
 * los necesita, justo cuando los necesita. Un token que viaja en un objeto que
 * acaba en un log es un token quemado.
 *
 * En reposo están cifrados con AES-256-GCM (`SecretBox`), así que un volcado de
 * la base no basta para robarlos: hace falta además la clave de la aplicación.
 */
export interface ChannelCredentials {
  /** Credenciales descifradas de una cuenta. Error si no hay o no descifran. */
  get(accountId: string): Promise<Result<Readonly<Record<string, string>>, AppError>>;
  /** Guarda cifrando. Reemplaza las anteriores por completo. */
  set(accountId: string, credentials: Readonly<Record<string, string>>): Promise<Result<void, AppError>>;
}

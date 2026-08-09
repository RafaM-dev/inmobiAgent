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

/**
 * Claves que el adaptador de WhatsApp espera en la bolsa de secretos.
 *
 * Viven JUNTO AL PUERTO y no dentro del adaptador porque son precisamente el
 * contrato entre quien rellena las credenciales —la ruta de alta— y quien las
 * consume. Tenerlas en `infrastructure/` obligaba a la ruta a importar del
 * adaptador, que es lo que el principio 2 prohíbe: nada fuera del canal debe
 * depender de WhatsApp.
 *
 * Que el nombre mencione WhatsApp no lo contradice, por lo mismo que
 * `ChannelType.WHATSAPP`: aquí es un *valor*, no una dependencia. Ninguna rama
 * de lógica pregunta «¿es WhatsApp?» para comportarse distinto.
 */
export const WHATSAPP_CREDENTIAL_KEYS = {
  /** Token permanente de la app de Meta. */
  accessToken: "accessToken",
  /** Secreto de la app: con él se firma y se verifica el webhook. */
  appSecret: "appSecret",
  /** Token que elegimos nosotros para el alta del webhook. */
  verifyToken: "verifyToken",
} as const;

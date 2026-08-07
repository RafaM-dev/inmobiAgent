import { createHmac } from "node:crypto";
import { safeEquals } from "../../../../../platform/crypto/secret-box";

/**
 * Verificación de la firma del webhook de Meta.
 *
 * Es lo ÚNICO que separa "un mensaje de un cliente" de "cualquiera en internet
 * escribiéndole a tus clientes". La URL del webhook es pública y adivinable; la
 * firma no.
 *
 * Meta envía la cabecera `X-Hub-Signature-256` con el valor
 * `sha256=<hmac hexadecimal del CUERPO CRUDO usando el App Secret>`.
 *
 * **Sobre el cuerpo crudo**: hay que firmar exactamente los bytes recibidos, no
 * el objeto ya parseado y vuelto a serializar. `JSON.parse` seguido de
 * `JSON.stringify` reordena claves y cambia el escapado de caracteres no ASCII
 * —y en español los hay en cada mensaje—, así que la firma dejaría de coincidir
 * de forma intermitente y sin explicación aparente.
 */

const PREFIX = "sha256=";

export const signPayload = (rawBody: string, appSecret: string): string =>
  `${PREFIX}${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;

export const verifyWebhookSignature = (input: {
  rawBody: string;
  header: string | undefined;
  appSecret: string;
}): boolean => {
  if (input.header?.startsWith(PREFIX) !== true) return false;
  if (input.appSecret.length === 0) return false;

  // Comparación en tiempo constante: un `===` filtraría, por cuánto tarda en
  // fallar, cuántos bytes iniciales acertó quien lo esté intentando.
  return safeEquals(input.header, signPayload(input.rawBody, input.appSecret));
};

/**
 * Verificación inicial del webhook (el `GET` que Meta hace una sola vez al
 * darlo de alta). Devuelve el `challenge` que hay que responder tal cual, o
 * `null` si el token no coincide.
 */
export const resolveVerificationChallenge = (input: {
  mode: string | undefined;
  token: string | undefined;
  challenge: string | undefined;
  expectedToken: string;
}): string | null => {
  if (input.mode !== "subscribe") return null;
  if (!input.token || !input.challenge) return null;
  if (input.expectedToken.length === 0) return null;

  return safeEquals(input.token, input.expectedToken) ? input.challenge : null;
};

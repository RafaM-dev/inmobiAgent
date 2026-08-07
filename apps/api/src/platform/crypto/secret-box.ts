import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "../errors/app-error";
import { ErrorCode } from "../errors/error-codes";
import { err, ok, type Result } from "../result/result";

/**
 * Cifrado de secretos en reposo (AES-256-GCM).
 *
 * Lo usan las credenciales de proveedor de cada inmobiliaria: el token de
 * WhatsApp de una agencia no puede quedar en claro en una tabla que consulta
 * medio equipo, ni aparecer en un volcado de la base.
 *
 * GCM y no CBC porque además de cifrar AUTENTICA: si alguien altera un byte del
 * ciphertext, el descifrado falla en vez de devolver basura silenciosa. Para
 * una credencial, "basura silenciosa" significa intentar autenticarse con un
 * token corrupto y no entender por qué.
 *
 * Formato del blob: `iv (12) ‖ authTag (16) ‖ ciphertext`. El IV es aleatorio
 * por operación —reutilizarlo con la misma clave rompe GCM por completo— y
 * viaja delante porque hace falta para descifrar y no es secreto.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `La clave de cifrado debe tener ${String(KEY_BYTES)} bytes (AES-256), tiene ${String(
          key.length,
        )}.`,
      );
    }
  }

  encrypt(plaintext: string): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);

    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  decrypt(blob: Buffer): Result<string, AppError> {
    if (blob.length <= IV_BYTES + TAG_BYTES) {
      return err(cryptoError("El secreto cifrado está truncado"));
    }

    const iv = blob.subarray(0, IV_BYTES);
    const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = blob.subarray(IV_BYTES + TAG_BYTES);

    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAuthTag(tag);
      return ok(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
    } catch {
      // Clave equivocada o blob manipulado. No se distingue a propósito: decirlo
      // sería filtrar información a quien esté probando.
      return err(cryptoError("No se pudo descifrar el secreto"));
    }
  }

  /** Objeto de credenciales ↔ blob. Es lo que guarda `channel_accounts`. */
  encryptJson(value: Readonly<Record<string, string>>): Buffer {
    return this.encrypt(JSON.stringify(value));
  }

  decryptJson(blob: Buffer): Result<Record<string, string>, AppError> {
    const plaintext = this.decrypt(blob);
    if (!plaintext.ok) return plaintext;

    try {
      const parsed: unknown = JSON.parse(plaintext.value);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return err(cryptoError("El secreto descifrado no es un objeto"));
      }
      return ok(parsed as Record<string, string>);
    } catch {
      return err(cryptoError("El secreto descifrado no es JSON válido"));
    }
  }
}

const cryptoError = (message: string): AppError =>
  new AppError({
    message,
    code: ErrorCode.INTERNAL,
    httpStatus: 500,
    operational: false,
  });

/**
 * Comparación en tiempo constante. Para firmas y tokens de verificación: un
 * `===` filtra por cuánto tarda en fallar cuántos bytes iniciales acertó quien
 * lo intenta.
 */
export const safeEquals = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  // `timingSafeEqual` exige la misma longitud; comparar longitudes no filtra
  // nada útil, porque la longitud de una firma es pública.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

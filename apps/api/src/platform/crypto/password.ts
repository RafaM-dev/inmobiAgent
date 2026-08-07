import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Hash de contraseñas con scrypt.
 *
 * **Por qué scrypt y no bcrypt ni argon2.** Los dos son buenos, y los dos son
 * dependencias nativas que hay que compilar —en Windows eso significa toolchain
 * de C++ y un `pnpm install` que falla en la máquina de alguien—. scrypt viene
 * en Node, está diseñado exactamente para esto (duro en memoria, no solo en
 * CPU) y es lo que recomienda OWASP cuando argon2id no está disponible. Para un
 * back-office de decenas de usuarios por inmobiliaria, es de sobra.
 *
 * El formato guardado es autodescriptivo: `scrypt$N$r$p$salt$hash`. Así, el día
 * que se suban los parámetros de coste, las contraseñas viejas siguen
 * verificándose con los suyos y se re-hashean al siguiente acceso.
 */

/** Parámetros de coste. N=16384 tarda ~50 ms, que es el orden correcto. */
const PARAMS = { N: 16_384, r: 8, p: 1, keyLength: 64 } as const;
const SALT_BYTES = 16;
const ALGORITHM = "scrypt";

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password.normalize("NFC"), salt, PARAMS.keyLength);

  return [
    ALGORITHM,
    String(PARAMS.N),
    String(PARAMS.r),
    String(PARAMS.p),
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
};

/**
 * Verificación en tiempo constante.
 *
 * Nunca lanza: una contraseña mal formada en la base es un `false`, no una
 * excepción que revele por su mensaje qué usuario existe.
 */
export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== ALGORITHM) return false;

  const [, , , , saltPart, hashPart] = parts;
  if (saltPart === undefined || hashPart === undefined) return false;

  try {
    const salt = Buffer.from(saltPart, "base64");
    const expected = Buffer.from(hashPart, "base64");
    const derived = await scrypt(password.normalize("NFC"), salt, expected.length);

    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
};

/**
 * Token de sesión: 256 bits de aleatoriedad criptográfica.
 *
 * Se guarda HASHEADO en la base —con SHA-256, que basta porque el token ya es
 * aleatorio y no hay nada que adivinar—: si alguien lee la tabla de sesiones,
 * no puede suplantar a nadie.
 */
export const generateSessionToken = (): string => randomBytes(32).toString("base64url");

/**
 * Huella del token de sesión para guardarlo.
 *
 * SHA-256 sin sal y sin coste, a diferencia de las contraseñas. No es un
 * descuido: un token de 256 bits aleatorios no se puede adivinar por fuerza
 * bruta ni con un diccionario, así que estirarlo no aporta nada y sí añadiría
 * 50 ms a CADA petición autenticada.
 */
export const hashSessionToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

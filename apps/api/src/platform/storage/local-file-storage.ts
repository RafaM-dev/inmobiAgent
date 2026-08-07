import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { AppError, InternalError, ValidationError } from "../errors/app-error";
import { ErrorCode } from "../errors/error-codes";
import { err, ok, okVoid, type Result } from "../result/result";
import type { FileStorage, PutFileInput, StoredFile } from "./file-storage";

/**
 * Almacenamiento en disco. El adaptador por defecto del modo demo.
 *
 * La validación de la clave no es paranoia decorativa: la clave lleva dentro el
 * `tenantId`, así que una clave manipulada con `../` sería un camino directo a
 * leer los documentos de otra inmobiliaria. Se normaliza y se comprueba que el
 * resultado sigue dentro del directorio raíz.
 */
export class LocalFileStorage implements FileStorage {
  readonly kind = "local";
  private readonly root: string;

  constructor(directory: string) {
    this.root = resolve(directory);
  }

  async put(input: PutFileInput): Promise<Result<StoredFile, AppError>> {
    const path = this.resolveKey(input.key);
    if (!path.ok) return path;

    try {
      await mkdir(dirname(path.value), { recursive: true });
      await writeFile(path.value, input.content);
      return ok({ ref: input.key, bytes: input.content.byteLength });
    } catch (cause) {
      return err(new InternalError("No se pudo guardar el archivo", cause));
    }
  }

  async get(ref: string): Promise<Result<Buffer, AppError>> {
    const path = this.resolveKey(ref);
    if (!path.ok) return path;

    try {
      return ok(await readFile(path.value));
    } catch (cause) {
      return err(
        new AppError({
          message: `No se encontró el archivo "${ref}"`,
          code: ErrorCode.NOT_FOUND,
          httpStatus: 404,
          cause,
        }),
      );
    }
  }

  async delete(ref: string): Promise<Result<void, AppError>> {
    const path = this.resolveKey(ref);
    if (!path.ok) return path;

    try {
      // `force` para que borrar algo que ya no está no sea un error: el borrado
      // tiene que poder reintentarse.
      await rm(path.value, { force: true });
      return okVoid();
    } catch (cause) {
      return err(new InternalError("No se pudo borrar el archivo", cause));
    }
  }

  /** Clave lógica → ruta real, garantizando que no se sale de la raíz. */
  private resolveKey(key: string): Result<string, AppError> {
    if (key.length === 0 || isAbsolute(key) || key.includes("\0")) {
      return err(new ValidationError("Clave de archivo inválida"));
    }

    const normalized = normalize(key);
    const full = resolve(join(this.root, normalized));

    if (full !== this.root && !full.startsWith(this.root + sep)) {
      return err(new ValidationError("Clave de archivo fuera del almacenamiento"));
    }

    return ok(full);
  }
}

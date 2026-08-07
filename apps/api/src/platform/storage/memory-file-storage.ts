import { AppError } from "../errors/app-error";
import { ErrorCode } from "../errors/error-codes";
import { err, ok, okVoid, type Result } from "../result/result";
import type { FileStorage, PutFileInput, StoredFile } from "./file-storage";

/** Almacenamiento en memoria para tests. No toca el disco ni deja restos. */
export class MemoryFileStorage implements FileStorage {
  readonly kind = "memory";
  private readonly files = new Map<string, Buffer>();

  put(input: PutFileInput): Promise<Result<StoredFile, AppError>> {
    this.files.set(input.key, Buffer.from(input.content));
    return Promise.resolve(ok({ ref: input.key, bytes: input.content.byteLength }));
  }

  get(ref: string): Promise<Result<Buffer, AppError>> {
    const found = this.files.get(ref);
    if (!found) {
      return Promise.resolve(
        err(
          new AppError({
            message: `No se encontró el archivo "${ref}"`,
            code: ErrorCode.NOT_FOUND,
            httpStatus: 404,
          }),
        ),
      );
    }
    return Promise.resolve(ok(found));
  }

  delete(ref: string): Promise<Result<void, AppError>> {
    this.files.delete(ref);
    return Promise.resolve(okVoid());
  }
}

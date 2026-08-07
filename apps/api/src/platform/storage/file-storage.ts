import type { AppError } from "../errors/app-error";
import type { Result } from "../result/result";

/**
 * PUERTO `FileStorage` — guardar el original de un archivo.
 *
 * Cierra la decisión abierta §18.2: disco local en desarrollo, y un adaptador
 * S3-compatible detrás de este mismo puerto cuando haya un despliegue real
 * (decisión D27). No se escribe hoy el de S3 por el mismo motivo que no hay
 * adaptador HTTP de catálogo (D15): sin un entorno concreto contra el que
 * probarlo, sería código que nadie ha ejecutado.
 *
 * Por qué guardar el original si el texto ya está troceado en la base:
 * **reindexar**. Cambiar de proveedor de embeddings, o afinar el troceado,
 * exige volver a leer el documento entero. Sin el original habría que pedirle
 * al cliente que lo vuelva a subir.
 */

export interface StoredFile {
  /** Referencia opaca con la que recuperarlo. La interpreta solo el adaptador. */
  readonly ref: string;
  readonly bytes: number;
}

export interface PutFileInput {
  /**
   * Clave lógica, con el tenant por delante: `<tenantId>/knowledge/<docId>`.
   * El adaptador la valida; no puede contener `..` ni rutas absolutas.
   */
  readonly key: string;
  readonly content: Buffer;
  readonly contentType: string;
}

export interface FileStorage {
  readonly kind: string;
  put(input: PutFileInput): Promise<Result<StoredFile, AppError>>;
  get(ref: string): Promise<Result<Buffer, AppError>>;
  delete(ref: string): Promise<Result<void, AppError>>;
}

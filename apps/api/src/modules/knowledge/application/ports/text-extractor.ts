import type { AppError } from "../../../../platform/errors/app-error";
import type { Result } from "../../../../platform/result/result";

/**
 * PUERTO `TextExtractor` — de un archivo a texto plano.
 *
 * Existe para que añadir un formato sea escribir un adaptador y no tocar la
 * ingesta. Hoy hay tres: texto plano y Markdown, PDF y Word.
 *
 * **El contenido llega como BYTES, no como texto.** Un PDF y un `.docx` son
 * binarios; obligarlos a pasar por una cadena UTF-8 los corrompe antes de que
 * el extractor los vea. El adaptador de texto plano decodifica él mismo, que es
 * la única forma de que los tres compartan una misma entrada.
 *
 * **`extract` es asíncrona** porque leer un PDF lo es. Sería más cómodo que no
 * lo fuera, pero fingir que un trabajo lento es instantáneo solo traslada el
 * problema a quien llama.
 */

export interface ExtractedText {
  readonly text: string;
  /** Título deducido del contenido, si lo trae. No sustituye al que dé el usuario. */
  readonly title?: string;
}

export interface ExtractionInput {
  readonly content: Buffer;
  readonly mimeType: string;
}

export interface TextExtractor {
  readonly name: string;
  /** Formatos legibles, para poder decir cuáles son cuando se rechaza uno. */
  readonly accepts: readonly string[];
  supports(mimeType: string): boolean;
  extract(input: ExtractionInput): Promise<Result<ExtractedText, AppError>>;
}

/** El tipo sin parámetros (`text/plain; charset=utf-8` → `text/plain`). */
export const baseMimeType = (mimeType: string): string =>
  mimeType.split(";")[0]?.trim().toLowerCase() ?? "";

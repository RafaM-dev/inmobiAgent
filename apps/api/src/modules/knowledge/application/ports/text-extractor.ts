import type { AppError } from "../../../../platform/errors/app-error";
import type { Result } from "../../../../platform/result/result";

/**
 * PUERTO `TextExtractor` — de un archivo a texto plano.
 *
 * Existe para que añadir PDF, DOCX o HTML sea escribir un adaptador y no tocar
 * la ingesta. En F5 solo hay uno, para texto plano y Markdown, y eso es una
 * decisión (D26): extraer bien un PDF con tablas o una página web con menús es
 * un problema propio, y una ingesta que produce basura en silencio envenena
 * todas las respuestas que vengan después. Es preferible rechazar el formato.
 */

export interface ExtractedText {
  readonly text: string;
  /** Título deducido del contenido, si lo trae. No sustituye al que dé el usuario. */
  readonly title?: string;
}

export interface ExtractionInput {
  readonly content: string;
  readonly mimeType: string;
}

export interface TextExtractor {
  readonly name: string;
  supports(mimeType: string): boolean;
  extract(input: ExtractionInput): Result<ExtractedText, AppError>;
}

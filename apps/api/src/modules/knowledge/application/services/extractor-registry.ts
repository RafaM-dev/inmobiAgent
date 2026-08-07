import { ValidationError, type AppError } from "../../../../platform/errors/app-error";
import { err, type Result } from "../../../../platform/result/result";
import type { ExtractedText, ExtractionInput, TextExtractor } from "../ports/text-extractor";

/**
 * Elige el extractor según el tipo de archivo.
 *
 * Un formato sin extractor se RECHAZA con un mensaje claro en vez de intentar
 * leerlo como texto plano. Un PDF interpretado como texto produce fragmentos de
 * basura binaria que luego se recuperan, se citan y acaban delante de un
 * cliente: es peor que no aceptar el archivo.
 */
export class ExtractorRegistry {
  private readonly extractors: TextExtractor[] = [];

  register(extractor: TextExtractor): void {
    this.extractors.push(extractor);
  }

  get supportedFormats(): readonly string[] {
    return this.extractors.map((extractor) => extractor.name);
  }

  extract(input: ExtractionInput): Result<ExtractedText, AppError> {
    const extractor = this.extractors.find((candidate) => candidate.supports(input.mimeType));

    if (!extractor) {
      return err(
        new ValidationError(
          `No sé leer archivos de tipo "${input.mimeType}". ` +
            "Por ahora se admiten texto plano y Markdown.",
        ),
      );
    }

    return extractor.extract(input);
  }
}

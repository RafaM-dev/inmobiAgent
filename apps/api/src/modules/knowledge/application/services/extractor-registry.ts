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

  /** Tipos MIME admitidos, para el mensaje de error y para el navegador. */
  get acceptedMimeTypes(): readonly string[] {
    return this.extractors.flatMap((extractor) => extractor.accepts);
  }

  async extract(input: ExtractionInput): Promise<Result<ExtractedText, AppError>> {
    const extractor = this.extractors.find((candidate) => candidate.supports(input.mimeType));

    if (!extractor) {
      /*
       * La lista se calcula, no se escribe a mano. Cuando estaba escrita decía
       * "texto plano y Markdown" y habría seguido diciéndolo después de añadir
       * PDF y Word: un mensaje de error que miente es peor que no tenerlo,
       * porque manda a quien lo lee a buscar en la dirección equivocada.
       */
      return err(
        new ValidationError(
          `No sé leer archivos de tipo "${input.mimeType}". ` +
            `Se admiten: ${this.acceptedMimeTypes.join(", ")}.`,
        ),
      );
    }

    return extractor.extract(input);
  }
}

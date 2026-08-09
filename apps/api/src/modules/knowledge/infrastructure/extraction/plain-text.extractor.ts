import { ValidationError, type AppError } from "../../../../platform/errors/app-error";
import { err, ok, type Result } from "../../../../platform/result/result";
import {
  baseMimeType,
  type ExtractedText,
  type ExtractionInput,
  type TextExtractor,
} from "../../application/ports/text-extractor";

/** Primer encabezado Markdown del documento: suele ser su título real. */
const TITLE = /^#\s+(.+)$/m;

/**
 * Texto plano y Markdown.
 *
 * El Markdown se conserva tal cual, sin convertirlo a texto: los `#` son lo que
 * permite a la política de troceado saber bajo qué epígrafe está cada párrafo,
 * y ese contexto es la diferencia entre citar "sesenta días de preaviso" y
 * citar "Terminación anticipada — sesenta días de preaviso".
 */
export class PlainTextExtractor implements TextExtractor {
  readonly name = "plain-text";
  readonly accepts = ["text/plain", "text/markdown", "text/x-markdown", "text/csv"];

  supports(mimeType: string): boolean {
    return this.accepts.includes(baseMimeType(mimeType));
  }

  extract(input: ExtractionInput): Promise<Result<ExtractedText, AppError>> {
    return Promise.resolve(this.read(input));
  }

  private read(input: ExtractionInput): Result<ExtractedText, AppError> {
    const text = input.content.toString("utf8").replace(/\r\n/g, "\n").trim();

    if (text.length === 0) {
      return err(new ValidationError("El documento no tiene contenido que indexar"));
    }

    const title = TITLE.exec(text)?.[1]?.trim();

    return ok({ text, ...(title ? { title } : {}) });
  }
}

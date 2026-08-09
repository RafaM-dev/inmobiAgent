import { UpstreamError, ValidationError, type AppError } from "../../../../platform/errors/app-error";
import { err, ok, type Result } from "../../../../platform/result/result";
import {
  baseMimeType,
  type ExtractedText,
  type ExtractionInput,
  type TextExtractor,
} from "../../application/ports/text-extractor";

/** Lo que el extractor necesita de la librería. Inyectable para poder probarlo. */
export type PdfReader = (bytes: Uint8Array) => Promise<{ totalPages: number; text: string }>;

/** Lectura real, con `unpdf` (el pdf.js de Mozilla empaquetado para Node). */
const defaultReader: PdfReader = async (bytes) => {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const document = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(document, { mergePages: true });
  return { totalPages, text };
};

/**
 * PDF.
 *
 * **El caso peligroso no es el PDF que falla: es el que se lee "bien" y viene
 * vacío.** Un reglamento escaneado es un PDF de imágenes sin una sola letra
 * dentro. Se ingiere sin error, se indexa sin fragmentos y el agente responde
 * "no lo sé" durante meses sin que nadie relacione una cosa con la otra. Por eso
 * aquí un PDF sin texto se RECHAZA, y el mensaje dice exactamente qué pasa y
 * qué hacer, en vez de hablar de bytes.
 *
 * No se hace OCR. Reconocer texto en imágenes es un problema aparte, con su
 * propio coste y sus propios errores; adivinar mal el contenido de un reglamento
 * es peor que no aceptarlo.
 *
 * Tampoco se deduce el título del contenido: en un PDF, lo que parece un título
 * es lo que está en letra más grande, y eso no se sabe leyendo el texto ya
 * extraído. Se queda con el nombre del archivo, que suele ser mejor pista.
 */
export class PdfExtractor implements TextExtractor {
  readonly name = "pdf";
  readonly accepts = ["application/pdf"];

  constructor(private readonly read: PdfReader = defaultReader) {}

  supports(mimeType: string): boolean {
    return this.accepts.includes(baseMimeType(mimeType));
  }

  async extract(input: ExtractionInput): Promise<Result<ExtractedText, AppError>> {
    let pages: number;
    let raw: string;

    try {
      const result = await this.read(new Uint8Array(input.content));
      pages = result.totalPages;
      raw = result.text;
    } catch (cause) {
      // Un PDF corrupto o cifrado no es un fallo del programa: es un archivo
      // que no se puede leer, y quien lo subió necesita saberlo.
      return err(
        new UpstreamError("pdf", "invalid_response", {
          message: "No se pudo abrir el PDF. Puede estar dañado o protegido con contraseña.",
          cause: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    }

    const text = normalize(raw);

    if (text.length === 0) {
      return err(
        new ValidationError(
          `Este PDF (${String(pages)} ${pages === 1 ? "página" : "páginas"}) no contiene texto: ` +
            "es un documento escaneado, una imagen. El agente no podría citar nada de él. " +
            "Conviértelo a texto con un OCR, o pega el contenido a mano.",
        ),
      );
    }

    return ok({ text });
  }
}

/**
 * Los PDF traen saltos de línea donde termina cada renglón impreso, no donde
 * termina cada frase. Sin arreglarlo, el troceado corta a mitad de oración y las
 * citas salen partidas.
 */
const normalize = (raw: string): string =>
  raw
    .replace(/\r\n/g, "\n")
    // Palabra cortada con guion al final del renglón: "convi-\nvencia".
    .replace(/(\p{Ll})-\n(\p{Ll})/gu, "$1$2")
    // Renglón que sigue la misma frase: se une con un espacio. Se respeta el
    // salto cuando la línea siguiente empieza en mayúscula, número o viñeta,
    // porque ahí sí suele haber un párrafo o un apartado nuevo.
    .replace(/(\p{Ll},?)\n(?=\p{Ll})/gu, "$1 ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

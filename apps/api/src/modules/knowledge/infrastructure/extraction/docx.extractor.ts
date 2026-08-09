import { UpstreamError, ValidationError, type AppError } from "../../../../platform/errors/app-error";
import { err, ok, type Result } from "../../../../platform/result/result";
import {
  baseMimeType,
  type ExtractedText,
  type ExtractionInput,
  type TextExtractor,
} from "../../application/ports/text-extractor";

/** Lo que el extractor necesita de la librería. Inyectable para poder probarlo. */
export type DocxReader = (content: Buffer) => Promise<{ value: string }>;

/**
 * Lectura real, con `mammoth`.
 *
 * A Markdown y NO a texto plano, que sería lo obvio. En un `.docx` los títulos
 * son estilos, no tamaños: `convertToMarkdown` los convierte en `#`, y esos `#`
 * son justo lo que la política de troceado usa para saber bajo qué epígrafe
 * cae cada párrafo. Con texto plano, "sesenta días de preaviso" se cita suelto;
 * con los encabezados puestos, se cita bajo "Terminación anticipada".
 */
/**
 * `convertToMarkdown` EXISTE en `mammoth` pero no está en sus tipos.
 *
 * Comprobado ejecutándolo, no leyéndolo: el módulo exporta `convertToHtml`,
 * `extractRawText` y `convertToMarkdown`, y su `.d.ts` solo declara los dos
 * primeros. Se describe aquí la firma exacta que se usa —y solo esa— en vez de
 * silenciar el error con `any`, que además desactivaría la comprobación del
 * argumento.
 */
interface MarkdownCapableMammoth {
  convertToMarkdown(input: { buffer: Buffer }): Promise<{ value: string }>;
}

const defaultReader: DocxReader = async (content) => {
  const mammoth = (await import("mammoth")) as unknown as MarkdownCapableMammoth;
  const { value } = await mammoth.convertToMarkdown({ buffer: content });
  return { value };
};

/**
 * Word (`.docx`).
 *
 * El `.doc` antiguo NO entra: es un formato binario distinto y leerlo a medias
 * produciría texto plausible pero incompleto, que es la peor forma de fallar en
 * una base de conocimiento.
 */
export class DocxExtractor implements TextExtractor {
  readonly name = "docx";
  readonly accepts = [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];

  constructor(private readonly read: DocxReader = defaultReader) {}

  supports(mimeType: string): boolean {
    return this.accepts.includes(baseMimeType(mimeType));
  }

  async extract(input: ExtractionInput): Promise<Result<ExtractedText, AppError>> {
    let raw: string;

    try {
      raw = (await this.read(input.content)).value;
    } catch (cause) {
      return err(
        new UpstreamError("docx", "invalid_response", {
          message: "No se pudo abrir el documento de Word. Puede estar dañado.",
          cause: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    }

    const text = unescapeMarkdown(raw).replace(/\n{3,}/g, "\n\n").trim();

    if (text.length === 0) {
      return err(
        new ValidationError(
          "Este documento de Word no tiene texto. Si su contenido son imágenes " +
            "escaneadas, el agente no podría citar nada de él.",
        ),
      );
    }

    const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();

    return ok({ text, ...(title ? { title } : {}) });
  }
}

/**
 * Quita el escapado de Markdown que introduce el conversor.
 *
 * `mammoth` escapa la puntuación para que el Markdown resultante sea válido, y
 * convierte "tres meses." en "tres meses\\.". Da igual mientras el texto solo se
 * indexe; deja de dar igual en cuanto el agente **cita ese fragmento a un
 * cliente**, que es exactamente lo que hace. Nadie debería recibir por WhatsApp
 * una barra invertida.
 *
 * Solo se desescapa la puntuación ASCII precedida de barra: en un documento
 * extraído no hay barras invertidas legítimas delante de un punto.
 */
const unescapeMarkdown = (value: string): string =>
  value.replace(/\\([\\`*_{}[\]()#+\-.!>])/g, "$1");

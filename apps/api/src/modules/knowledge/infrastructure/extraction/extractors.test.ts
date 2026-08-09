import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { isErr, isOk } from "../../../../platform/result/result";
import { ExtractorRegistry } from "../../application/services/extractor-registry";
import { DocxExtractor } from "./docx.extractor";
import { PdfExtractor } from "./pdf.extractor";
import { PlainTextExtractor } from "./plain-text.extractor";

/**
 * Extracción de texto, contra archivos DE VERDAD.
 *
 * Los ficheros se construyen aquí en vez de guardarse como adjuntos binarios:
 * así se ve qué contiene cada caso y por qué, y una prueba que falla se puede
 * leer sin abrir un PDF con un editor hexadecimal.
 *
 * Lo que se comprueba de verdad es el caso silencioso: un PDF escaneado no
 * falla al leerse —simplemente no tiene texto—, se indexa vacío, y el agente
 * responde "no lo sé" durante meses sin que nadie sepa por qué.
 */

/** PDF mínimo válido, con su texto sin comprimir. */
const buildPdf = (lines: readonly string[]): Buffer => {
  const body = lines
    .map((line, i) => `BT /F1 12 Tf 72 ${String(720 - i * 24)} Td (${line}) Tj ET`)
    .join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R " +
      "/Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${String(body.length)} >>\nstream\n${body}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(pdf.length);
    pdf += `${String(i + 1)} 0 obj\n${object}\nendobj\n`;
  });

  const xref = pdf.length;
  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\n`;
  pdf += `startxref\n${String(xref)}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
};

/** `.docx` mínimo: es un zip con XML dentro. */
const buildDocx = async (paragraphs: readonly { text: string; heading?: boolean }[]) => {
  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip
    .folder("_rels")
    ?.file(
      ".rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    );

  const body = paragraphs
    .map(
      (p) =>
        `<w:p>${p.heading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : ""}` +
        `<w:r><w:t>${p.text}</w:t></w:r></w:p>`,
    )
    .join("");

  zip
    .folder("word")
    ?.file(
      "document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    );

  return zip.generateAsync({ type: "nodebuffer" });
};

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("PDF", () => {
  const extractor = new PdfExtractor();

  it("saca el texto de un PDF de verdad", async () => {
    const pdf = buildPdf(["Reglamento de convivencia", "Se admiten mascotas hasta 10 kg."]);

    const result = await extractor.extract({ content: pdf, mimeType: "application/pdf" });

    if (!isOk(result)) throw new Error("debería leerlo");
    expect(result.value.text).toContain("Reglamento de convivencia");
    expect(result.value.text).toContain("mascotas hasta 10 kg");
  });

  it("RECHAZA un PDF sin texto y dice que está escaneado", async () => {
    /*
     * El caso que justifica todo esto. Un reglamento escaneado es un PDF de
     * imágenes: no falla, simplemente no tiene ni una letra. Aceptarlo deja un
     * documento "indexado" del que el agente no puede citar nada.
     */
    const vacio = buildPdf([]);

    const result = await extractor.extract({ content: vacio, mimeType: "application/pdf" });

    expect(isErr(result)).toBe(true);
    const message = isErr(result) ? result.error.message : "";
    expect(message).toContain("escaneado");
    expect(message).toContain("OCR");
  });

  it("un archivo que no es un PDF da error, no basura", async () => {
    const result = await extractor.extract({
      content: Buffer.from("esto no es un pdf"),
      mimeType: "application/pdf",
    });

    expect(isErr(result)).toBe(true);
  });

  it("une los renglones partidos de una misma frase", async () => {
    // Los PDF cortan por renglón impreso, no por frase. Sin unirlos, el
    // troceado parte a mitad de oración y las citas salen cortadas.
    const reader = () =>
      Promise.resolve({
        totalPages: 1,
        text: "El preaviso es de sesenta\ndias naturales.\n\nCapitulo II",
      });

    const result = await new PdfExtractor(reader).extract({
      content: Buffer.alloc(0),
      mimeType: "application/pdf",
    });

    if (!isOk(result)) throw new Error("debería leerlo");
    expect(result.value.text).toContain("sesenta dias naturales");
    // Pero el salto de párrafo real se respeta.
    expect(result.value.text).toContain("\n\nCapitulo II");
  });

  it("recompone las palabras cortadas con guion", async () => {
    const reader = () => Promise.resolve({ totalPages: 1, text: "normas de convi-\nvencia" });

    const result = await new PdfExtractor(reader).extract({
      content: Buffer.alloc(0),
      mimeType: "application/pdf",
    });

    expect(isOk(result) && result.value.text).toBe("normas de convivencia");
  });
});

describe("Word", () => {
  const extractor = new DocxExtractor();

  it("saca el texto de un .docx de verdad", async () => {
    const docx = await buildDocx([
      { text: "Requisitos para arrendar", heading: true },
      { text: "Certificado laboral de los ultimos tres meses." },
    ]);

    const result = await extractor.extract({ content: docx, mimeType: DOCX_MIME });

    if (!isOk(result)) throw new Error("debería leerlo");
    expect(result.value.text).toContain("Certificado laboral");
  });

  it("conserva los encabezados como Markdown", async () => {
    /*
     * No es cosmético: el troceado usa los `#` para saber bajo qué epígrafe cae
     * cada párrafo, y de ahí sale la diferencia entre citar "sesenta días de
     * preaviso" suelto y citarlo bajo "Terminación anticipada".
     */
    const docx = await buildDocx([
      { text: "Terminacion anticipada", heading: true },
      { text: "Sesenta dias de preaviso." },
    ]);

    const result = await extractor.extract({ content: docx, mimeType: DOCX_MIME });

    if (!isOk(result)) throw new Error("debería leerlo");
    expect(result.value.text).toContain("# Terminacion anticipada");
    // Y de ahí sale el título del documento.
    expect(result.value.title).toBe("Terminacion anticipada");
  });

  it("no deja barras invertidas en el texto que verá el cliente", async () => {
    // El conversor escapa la puntuación para producir Markdown válido. Da igual
    // mientras solo se indexe; deja de dar igual cuando el agente cita ese
    // fragmento por WhatsApp.
    const docx = await buildDocx([{ text: "El deposito equivale a un mes (1) de canon." }]);

    const result = await extractor.extract({ content: docx, mimeType: DOCX_MIME });

    if (!isOk(result)) throw new Error("debería leerlo");
    expect(result.value.text).not.toContain("\\");
    expect(result.value.text).toContain("un mes (1) de canon.");
  });

  it("un archivo que no es un .docx da error", async () => {
    const result = await extractor.extract({
      content: Buffer.from("PK esto no es un docx"),
      mimeType: DOCX_MIME,
    });

    expect(isErr(result)).toBe(true);
  });
});

describe("Registro de extractores", () => {
  const registry = new ExtractorRegistry();
  registry.register(new PlainTextExtractor());
  registry.register(new PdfExtractor());
  registry.register(new DocxExtractor());

  it("manda cada tipo a su extractor", async () => {
    const texto = await registry.extract({
      content: Buffer.from("# Titulo\n\nCuerpo del documento."),
      mimeType: "text/markdown",
    });

    expect(isOk(texto) && texto.value.title).toBe("Titulo");
  });

  it("acepta el tipo con parámetros, como lo manda un navegador", async () => {
    const result = await registry.extract({
      content: Buffer.from("hola"),
      mimeType: "text/plain; charset=utf-8",
    });

    expect(isOk(result)).toBe(true);
  });

  it("rechaza un formato desconocido enumerando los que sí admite", async () => {
    const result = await registry.extract({
      content: Buffer.from("%!PS"),
      mimeType: "application/postscript",
    });

    expect(isErr(result)).toBe(true);
    const message = isErr(result) ? result.error.message : "";
    // La lista se calcula: cuando estaba escrita a mano decía "texto plano y
    // Markdown" y habría seguido diciéndolo después de añadir PDF y Word.
    expect(message).toContain("application/pdf");
    expect(message).toContain("text/plain");
  });

  it("el .doc antiguo no cuela por parecerse al .docx", async () => {
    const result = await registry.extract({
      content: Buffer.from("cualquier cosa"),
      mimeType: "application/msword",
    });

    expect(isErr(result)).toBe(true);
  });
});

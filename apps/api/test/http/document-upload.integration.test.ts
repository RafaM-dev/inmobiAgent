import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedTenant, type SeededTenant } from "../support/fixtures";
import { withApplication, type ApplicationContext } from "../support/integration-harness";

/**
 * SUBIR UN PDF, de punta a punta y por HTTP.
 *
 * Los extractores tienen su propia prueba contra archivos reales; lo que se
 * comprueba aquí es el trecho que solo existe en la frontera: que un binario
 * sobreviva al viaje dentro de un JSON. Es donde un fallo no da error —un
 * archivo cortado a la mitad se "lee" igual— y acaba en un documento indexado
 * con texto incompleto que el agente citará como si estuviera entero.
 */

/** PDF mínimo válido con el texto que se quiera dentro, sin comprimir. */
const buildPdf = (line: string): Buffer => {
  const body = `BT /F1 12 Tf 72 700 Td (${line}) Tj ET`;
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

const sessionCookie = (response: LightMyRequestResponse): string => {
  const raw = response.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const cookie = list.find((value) => value.startsWith("agentinmobi_session="));
  return cookie ? (cookie.split(";")[0] ?? "") : "";
};

describe("Subir documentos por HTTP", () => {
  let context: ApplicationContext;
  let tenant: SeededTenant;
  let cookie: string;
  let collectionId: string;

  const upload = (payload: Record<string, unknown>) =>
    context.server.inject({
      method: "POST",
      url: "/api/knowledge/documents",
      headers: { cookie },
      payload: { collectionId, sourceType: "UPLOAD", ...payload },
    });

  beforeAll(async () => {
    context = await withApplication();
  });

  afterAll(async () => {
    await context.stop();
  });

  beforeEach(async () => {
    await context.reset();
    tenant = await seedTenant(context.app.cradle, { slug: "documentos-propiedades" });

    const login = await context.server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { tenantSlug: tenant.slug, email: tenant.email, password: tenant.password },
    });
    cookie = sessionCookie(login);

    await context.server.inject({
      method: "POST",
      url: "/api/knowledge/collections",
      headers: { cookie },
      payload: { slug: "politicas", name: "Políticas" },
    });

    const collections = await context.server.inject({
      method: "GET",
      url: "/api/knowledge/collections",
      headers: { cookie },
    });
    collectionId = collections.json<{ items: { id: string; slug: string }[] }>().items[0]?.id ?? "";
  });

  it("un PDF viaja en base64 y llega entero", async () => {
    const pdf = buildPdf("El preaviso es de sesenta dias naturales.");

    const response = await upload({
      title: "Reglamento.pdf",
      mimeType: "application/pdf",
      content: pdf.toString("base64"),
      encoding: "base64",
    });

    // 202: guardado y en cola de indexado. Que llegue aquí ya demuestra que el
    // PDF se descodificó y se pudo leer: la extracción ocurre en la ingesta.
    expect(response.statusCode).toBe(202);
    expect(response.json<{ created: boolean }>().created).toBe(true);
  });

  it("lo que se guarda es el TEXTO extraído, no el PDF", async () => {
    /*
     * Es lo que hace que reindexar sea barato y determinista: al cambiar de
     * modelo de embeddings no hay que volver a abrir el PDF ni depender de que
     * la librería siga comportándose igual.
     */
    const pdf = buildPdf("Se admiten mascotas hasta diez kilos.");

    await upload({
      title: "Convivencia.pdf",
      mimeType: "application/pdf",
      content: pdf.toString("base64"),
      encoding: "base64",
    });

    const rows = await context.sql((tx) =>
      tx.document.findMany({ select: { sourceRef: true, mimeType: true } }),
    );
    expect(rows).toHaveLength(1);
    // El tipo ORIGINAL se conserva, para poder enseñarlo en el panel…
    expect(rows[0]?.mimeType).toBe("application/pdf");

    // …pero el archivo guardado ya es texto legible.
    const ref = rows[0]?.sourceRef ?? "";
    const stored = await context.app.cradle.fileStorage.get(ref);
    const contenido = stored.ok ? stored.value.toString("utf8") : "";
    expect(contenido).toContain("mascotas hasta diez kilos");
    expect(contenido).not.toContain("%PDF");
  });

  it("un PDF escaneado se RECHAZA en vez de indexarse vacío", async () => {
    const sinTexto = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF",
      "latin1",
    );

    const response = await upload({
      title: "Escaneado.pdf",
      mimeType: "application/pdf",
      content: sinTexto.toString("base64"),
      encoding: "base64",
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    const rows = await context.sql((tx) => tx.document.findMany());
    expect(rows).toHaveLength(0);
  });

  it("un base64 cortado a la mitad se rechaza, no se indexa a medias", async () => {
    const pdf = buildPdf("Contenido completo del reglamento.").toString("base64");

    const response = await upload({
      title: "Cortado.pdf",
      mimeType: "application/pdf",
      content: pdf.slice(0, Math.floor(pdf.length / 2)),
      encoding: "base64",
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("el texto pegado a mano sigue funcionando igual", async () => {
    const response = await context.server.inject({
      method: "POST",
      url: "/api/knowledge/documents",
      headers: { cookie },
      payload: {
        collectionId,
        sourceType: "TEXT",
        title: "Requisitos",
        mimeType: "text/markdown",
        content: "# Requisitos\n\nCertificado laboral de los últimos tres meses.",
      },
    });

    // Sin `encoding`: el contrato lo asume UTF-8, como antes de existir el campo.
    expect(response.statusCode).toBe(202);
  });
});

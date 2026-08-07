import { describe, expect, it } from "vitest";
import { HeuristicTokenCounter } from "../../../../platform/text/token-counter";
import { chunkDocument, toEmbeddableText, DEFAULT_CHUNKING } from "./chunking.policy";

const counter = new HeuristicTokenCounter();
const chunk = (text: string, options = DEFAULT_CHUNKING) =>
  chunkDocument(text, counter, options);

const paragraph = (word: string, times: number): string =>
  Array.from({ length: times }, () => word).join(" ");

describe("Política de troceado", () => {
  it("un texto corto es un solo fragmento", () => {
    const chunks = chunk("El canon se paga los cinco primeros días de cada mes.");

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain("cinco primeros días");
    expect(chunks[0]?.ordinal).toBe(0);
  });

  it("un texto vacío no produce fragmentos", () => {
    expect(chunk("")).toHaveLength(0);
    expect(chunk("   \n\n  ")).toHaveLength(0);
  });

  it("respeta el presupuesto de tokens", () => {
    const texto = Array.from({ length: 12 }, (_, i) => paragraph(`parrafo${String(i)}`, 60)).join(
      "\n\n",
    );

    const chunks = chunk(texto);

    expect(chunks.length).toBeGreaterThan(1);
    for (const item of chunks) {
      // El solape puede empujar un poco por encima del objetivo; nunca al doble.
      expect(item.tokens).toBeLessThanOrEqual(DEFAULT_CHUNKING.targetTokens * 2);
    }
  });

  it("corta por párrafos, no a mitad de frase", () => {
    const texto = Array.from({ length: 10 }, (_, i) =>
      `Este es el párrafo número ${String(i)} y ${paragraph("relleno", 40)}.`,
    ).join("\n\n");

    for (const item of chunk(texto)) {
      expect(item.content.startsWith("Este es el párrafo")).toBe(true);
    }
  });

  it("un párrafo enorme se parte por frases", () => {
    const frases = Array.from(
      { length: 40 },
      (_, i) => `Esta es la frase número ${String(i)} del bloque ${paragraph("largo", 15)}.`,
    ).join(" ");

    const chunks = chunk(frases);

    expect(chunks.length).toBeGreaterThan(1);
    // Ninguna frase queda cortada por la mitad.
    for (const item of chunks) {
      expect(item.content.trim().endsWith(".")).toBe(true);
    }
  });

  it("el encabezado viaja con el fragmento", () => {
    const texto = [
      "# Políticas de arriendo",
      "",
      "El canon se paga por adelantado.",
      "",
      "## Mascotas",
      "",
      "Se permiten mascotas de hasta quince kilos.",
    ].join("\n");

    const chunks = chunk(texto);

    expect(chunks[0]?.heading).toBe("Políticas de arriendo");
    // El encabezado NO ensucia el texto que se cita literalmente.
    expect(chunks[0]?.content).not.toContain("#");
  });

  it("el texto que se vectoriza lleva el encabezado; el que se cita, no", () => {
    const texto = "## Terminación anticipada\n\nSe exigen sesenta días de preaviso.";
    const [item] = chunk(texto);

    expect(item?.content).toBe("Se exigen sesenta días de preaviso.");
    expect(toEmbeddableText(item ?? { ordinal: 0, content: "", tokens: 0 })).toContain(
      "Terminación anticipada",
    );
  });

  it("hay solape entre fragmentos consecutivos", () => {
    // Prosa realista: párrafos de varias frases, como un reglamento de verdad.
    const texto = Array.from(
      { length: 8 },
      (_, i) =>
        `Cláusula ${String(i)}. ${paragraph("obligacion", 20)}. ` +
        `Las partes acuerdan ${paragraph("condicion", 18)}. ` +
        `El incumplimiento implica ${paragraph("sancion", 15)}.`,
    ).join("\n\n");

    const chunks = chunk(texto);
    expect(chunks.length).toBeGreaterThan(1);

    // El final de un fragmento reaparece al principio del siguiente: es lo que
    // evita perder lo que cae justo en la frontera.
    const finalDelPrimero = chunks[0]?.content.split(/(?<=\.)\s+/).at(-1) ?? "";
    expect(finalDelPrimero.length).toBeGreaterThan(0);
    expect(chunks[1]?.content).toContain(finalDelPrimero);
  });

  it("nunca parte una frase para conseguir solape", () => {
    // Un párrafo que es una sola frase larguísima: preferimos quedarnos sin
    // solape antes que entregar media idea como cita.
    const texto = Array.from({ length: 6 }, (_, i) =>
      `Bloque ${String(i)} ${paragraph("contenido", 60)}.`,
    ).join("\n\n");

    for (const item of chunk(texto)) {
      expect(item.content.trimEnd().endsWith(".")).toBe(true);
    }
  });

  it("una cola diminuta se une al fragmento anterior en vez de quedar suelta", () => {
    const texto = `${Array.from({ length: 6 }, (_, i) => paragraph(`bloque${String(i)}`, 60)).join(
      "\n\n",
    )}\n\nFin.`;

    const chunks = chunk(texto);

    expect(chunks.at(-1)?.tokens).toBeGreaterThanOrEqual(DEFAULT_CHUNKING.minTokens);
    expect(chunks.at(-1)?.content).toContain("Fin.");
  });

  it("es determinista: reindexar no cambia las citas ya entregadas", () => {
    const texto = Array.from({ length: 10 }, (_, i) => paragraph(`p${String(i)}`, 50)).join("\n\n");

    expect(chunk(texto)).toEqual(chunk(texto));
  });

  it("los ordinales son consecutivos desde cero", () => {
    const texto = Array.from({ length: 10 }, (_, i) => paragraph(`p${String(i)}`, 50)).join("\n\n");

    const ordinals = chunk(texto).map((item) => item.ordinal);
    expect(ordinals).toEqual(ordinals.map((_, index) => index));
  });
});

import { describe, expect, it } from "vitest";
import { defaultCapabilities } from "../../domain/value-objects/channel-capabilities";
import type { ReplyBlock } from "../../domain/value-objects/reply-block";
import { renderBlocks } from "./channel-renderer";

const poor = defaultCapabilities({ maxTextLength: 100 });
const rich = defaultCapabilities({
  supportsQuickReplies: true,
  supportsRichCards: true,
  supportsMedia: true,
  supportsLinkPreview: true,
});

const texts = (blocks: ReplyBlock[]): string[] =>
  blocks.filter((b): b is Extract<ReplyBlock, { kind: "text" }> => b.kind === "text").map((b) => b.text);

describe("renderBlocks", () => {
  it("un canal rico recibe los bloques tal cual", () => {
    const blocks: ReplyBlock[] = [
      { kind: "quick_replies", prompt: "¿Qué buscas?", options: [{ label: "Arriendo", value: "RENT" }] },
      { kind: "media", url: "https://x/y.jpg", mediaType: "image" },
      { kind: "link", url: "https://x", label: "Ficha" },
    ];

    expect(renderBlocks(blocks, rich).map((b) => b.kind)).toEqual([
      "quick_replies",
      "media",
      "link",
    ]);
  });

  it("sin botones, las opciones se convierten en lista numerada", () => {
    const rendered = renderBlocks(
      [
        {
          kind: "quick_replies",
          prompt: "¿Comprar o arrendar?",
          options: [
            { label: "Comprar", value: "SALE" },
            { label: "Arrendar", value: "RENT" },
          ],
        },
      ],
      poor,
    );

    expect(rendered).toHaveLength(1);
    expect(texts(rendered)[0]).toBe("¿Comprar o arrendar?\n1. Comprar\n2. Arrendar");
  });

  it("sin tarjetas, una lista de inmuebles se vuelve texto estructurado con sus datos", () => {
    const rendered = renderBlocks(
      [
        {
          kind: "property_list",
          intro: "Encontré 2 opciones:",
          items: [
            {
              reference: "A-1",
              title: "Apartamento en Laureles",
              price: "$450.000.000",
              location: "Medellín, Laureles",
              attributes: [
                { label: "Habitaciones", value: "3" },
                { label: "Área", value: "92 m²" },
              ],
            },
            { reference: "A-2", title: "Apartaestudio en Envigado", price: "$1.800.000/mes" },
          ],
          more: true,
        },
      ],
      defaultCapabilities({ maxTextLength: 4000 }),
    );

    const text = texts(rendered).join("\n");
    expect(text).toContain("1. Apartamento en Laureles");
    expect(text).toContain("$450.000.000");
    expect(text).toContain("Habitaciones: 3 · Área: 92 m²");
    expect(text).toContain("2. Apartaestudio en Envigado");
    expect(text).toContain("¿Quieres ver más opciones?");
  });

  it("trocea el texto largo respetando el límite del canal", () => {
    const long = "palabra ".repeat(60).trim(); // ~480 caracteres

    const rendered = renderBlocks([{ kind: "text", text: long }], poor);

    expect(rendered.length).toBeGreaterThan(1);
    for (const chunk of texts(rendered)) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
    // No se pierde contenido al trocear.
    expect(texts(rendered).join(" ").replace(/\s+/g, " ")).toBe(long);
  });

  it("sin soporte de media, el adjunto se degrada a su URL con leyenda", () => {
    const rendered = renderBlocks(
      [{ kind: "media", url: "https://x/y.jpg", mediaType: "image", caption: "Fachada" }],
      defaultCapabilities({ maxTextLength: 4000 }),
    );

    expect(texts(rendered)[0]).toBe("Fachada\nhttps://x/y.jpg");
  });

  it("el aviso de escalamiento sobrevive a cualquier canal", () => {
    const rendered = renderBlocks(
      [{ kind: "handoff_notice", reason: "USER_REQUEST", message: "Te paso con un asesor" }],
      poor,
    );

    expect(rendered[0]?.kind).toBe("handoff_notice");
  });
});

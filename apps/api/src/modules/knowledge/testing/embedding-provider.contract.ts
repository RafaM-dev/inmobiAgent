import { describe, expect, it } from "vitest";
import { isOk } from "../../../platform/result/result";
import { cosineSimilarity, type EmbeddingProvider } from "../application/ports/embedding-provider";

/**
 * SUITE DE CONTRATO de `EmbeddingProvider`.
 *
 * La misma idea que en `LLMProvider` y `PropertyService`: estas pruebas se
 * ejecutan contra el simulador hoy y contra OpenAI u Ollama en F8, sin cambiar
 * una línea. Si un adaptador real no las pasa, el problema es del adaptador.
 *
 * La comprobación que de verdad vale es la última: que textos relacionados
 * queden más cerca que textos ajenos. Un proveedor puede devolver vectores con
 * la dimensión correcta y ser completamente inútil; esa prueba lo detecta.
 */
export const describeEmbeddingProviderContract = (
  name: string,
  create: () => EmbeddingProvider,
): void => {
  describe(`Contrato de EmbeddingProvider — ${name}`, () => {
    it("declara su modelo y su dimensión", () => {
      const provider = create();

      expect(provider.id.length).toBeGreaterThan(0);
      expect(provider.model.length).toBeGreaterThan(0);
      expect(provider.dimensions).toBeGreaterThan(0);
    });

    it("es determinista: el mismo texto da el mismo vector", async () => {
      const provider = create();

      const first = await provider.embedDocuments(["El canon se paga los cinco primeros días."]);
      const second = await provider.embedDocuments(["El canon se paga los cinco primeros días."]);

      if (!isOk(first) || !isOk(second)) throw new Error("debería vectorizar");
      expect(first.value[0]).toEqual(second.value[0]);
    });

    it("devuelve un vector por texto, en el mismo orden y con la dimensión declarada", async () => {
      const provider = create();
      const texts = ["primero", "segundo", "tercero"];

      const result = await provider.embedDocuments(texts);

      if (!isOk(result)) throw new Error("debería vectorizar");
      expect(result.value).toHaveLength(texts.length);
      for (const vector of result.value) {
        expect(vector).toHaveLength(provider.dimensions);
        expect(vector.every((value) => Number.isFinite(value))).toBe(true);
      }

      // El orden importa: se emparejan por posición con los fragmentos.
      const solo = await provider.embedDocuments(["segundo"]);
      if (!isOk(solo)) throw new Error("debería vectorizar");
      expect(result.value[1]).toEqual(solo.value[0]);
    });

    it("un lote vacío devuelve un lote vacío, no un error", async () => {
      const result = await create().embedDocuments([]);

      if (!isOk(result)) throw new Error("debería aceptar el lote vacío");
      expect(result.value).toHaveLength(0);
    });

    it("una pregunta y un documento viven en el mismo espacio", async () => {
      const provider = create();

      const query = await provider.embedQuery("¿aceptan mascotas en el edificio?");
      const documents = await provider.embedDocuments([
        "El reglamento permite mascotas de hasta quince kilos en las unidades residenciales.",
        "El impuesto predial se liquida cada año sobre el avalúo catastral del inmueble.",
      ]);

      if (!isOk(query) || !isOk(documents)) throw new Error("debería vectorizar");

      const relevante = cosineSimilarity(query.value, documents.value[0] ?? []);
      const ajeno = cosineSimilarity(query.value, documents.value[1] ?? []);

      // Es LA propiedad que hace útil a un proveedor de embeddings. Sin ella,
      // el resto del contrato se cumple y la búsqueda no sirve para nada.
      expect(relevante).toBeGreaterThan(ajeno);
    });

    it("un texto se parece más a sí mismo que a cualquier otro", async () => {
      const provider = create();
      const texto = "El contrato de arrendamiento exige un mes de depósito.";

      const result = await provider.embedDocuments([
        texto,
        "El contrato de arrendamiento exige un mes de depósito y una póliza.",
        "Las oficinas del norte tienen parqueadero para visitantes.",
      ]);

      if (!isOk(result)) throw new Error("debería vectorizar");
      const [base, parecido, distinto] = result.value;

      expect(cosineSimilarity(base ?? [], parecido ?? [])).toBeGreaterThan(
        cosineSimilarity(base ?? [], distinto ?? []),
      );
    });
  });
};

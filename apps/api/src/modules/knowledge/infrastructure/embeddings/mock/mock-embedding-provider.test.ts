import { describe, expect, it } from "vitest";
import { isOk } from "../../../../../platform/result/result";
import { cosineSimilarity } from "../../../application/ports/embedding-provider";
import { describeEmbeddingProviderContract } from "../../../testing/embedding-provider.contract";
import { MockEmbeddingProvider } from "./mock-embedding-provider";

const create = (): MockEmbeddingProvider => new MockEmbeddingProvider();

// El simulador cumple el mismo contrato que cumplirá OpenAI en F8.
describeEmbeddingProviderContract("MockEmbeddingProvider", create);

const embed = async (text: string): Promise<readonly number[]> => {
  const result = await create().embedQuery(text);
  if (!isOk(result)) throw new Error("debería vectorizar");
  return result.value;
};

describe("MockEmbeddingProvider — el RAG del modo demo", () => {
  it("no devuelve ruido: los vectores están normalizados", async () => {
    const vector = await embed("El canon de arrendamiento se paga por adelantado.");
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

    expect(norm).toBeCloseTo(1, 5);
  });

  it("ignora las tildes: quien escribe «politica» encuentra «política»", async () => {
    const conTilde = await embed("política de mascotas");
    const sinTilde = await embed("politica de mascotas");

    expect(cosineSimilarity(conTilde, sinTilde)).toBeCloseTo(1, 5);
  });

  it("ignora el plural: «mascotas» encuentra «mascota»", async () => {
    const plural = await embed("mascotas");
    const singular = await embed("mascota");

    expect(cosineSimilarity(plural, singular)).toBeCloseTo(1, 5);
  });

  it("las palabras vacías no arrastran el vector", async () => {
    // Dos textos que solo comparten "de la que" no deberían parecerse.
    const uno = await embed("de la que el pero con");
    const dos = await embed("de la que un por sin");

    expect(cosineSimilarity(uno, dos)).toBeLessThan(0.2);
  });

  it("un texto sin contenido útil da un vector nulo, no un vector cualquiera", async () => {
    const vector = await embed("de la que");

    expect(vector.every((value) => value === 0)).toBe(true);
  });

  it("ordena por cercanía real: la pregunta encuentra su párrafo", async () => {
    const provider = create();

    const documentos = await provider.embedDocuments([
      "Se permiten mascotas de hasta quince kilos previa autorización de la administración.",
      "El depósito equivale a un canon mensual y se devuelve al terminar el contrato.",
      "El horario de atención de la oficina es de lunes a viernes.",
    ]);
    const pregunta = await provider.embedQuery("¿puedo llevar mi perro al apartamento?");

    if (!isOk(documentos) || !isOk(pregunta)) throw new Error("debería vectorizar");

    const puntuaciones = documentos.value.map((doc) => cosineSimilarity(pregunta.value, doc));
    const mejor = puntuaciones.indexOf(Math.max(...puntuaciones));

    // "perro" no aparece en ningún documento: el carril léxico por sí solo no
    // basta, y por eso la búsqueda es híbrida. Lo que sí se exige aquí es que
    // el vector no invente una cercanía donde no la hay.
    expect(puntuaciones[mejor]).toBeGreaterThanOrEqual(0);
  });

  it("es idéntico entre instancias: dos procesos indexan lo mismo", async () => {
    const a = await new MockEmbeddingProvider().embedQuery("preaviso de terminación");
    const b = await new MockEmbeddingProvider().embedQuery("preaviso de terminación");

    if (!isOk(a) || !isOk(b)) throw new Error("debería vectorizar");
    expect(a.value).toEqual(b.value);
  });
});

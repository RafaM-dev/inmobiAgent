import { describe, expect, it } from "vitest";
import type { ChunkMatch } from "../repositories/knowledge.repositories";
import { fuseRankings } from "./rank-fusion.policy";

const match = (id: string, rawScore = 0): ChunkMatch => ({
  chunkId: id,
  documentId: `doc-${id}`,
  collectionId: "col-1",
  ordinal: 0,
  content: `contenido ${id}`,
  documentTitle: `Documento ${id}`,
  collectionName: "Políticas",
  rawScore,
});

describe("Fusión de rankings (RRF)", () => {
  it("lo que aparece en los dos carriles gana a lo que solo aparece en uno", () => {
    const fused = fuseRankings({
      vector: [match("a"), match("b")],
      text: [match("c"), match("a")],
    });

    // "a" sale 1.º en vectorial y 2.º en léxico; "b" y "c" salen solo en uno.
    expect(fused[0]?.match.chunkId).toBe("a");
    expect(fused[0]?.lanes).toEqual(["vector", "text"]);
  });

  it("ignora la escala de las puntuaciones crudas", () => {
    // El carril léxico trae puntuaciones ridículas comparadas con el coseno.
    // Si se sumaran, el vectorial ganaría siempre; con RRF, manda el puesto.
    const fused = fuseRankings({
      vector: [match("solo-vector", 0.91)],
      text: [match("doble", 0.02), match("solo-vector", 0.01)],
    });

    expect(fused[0]?.match.chunkId).toBe("solo-vector");
    expect(fused[0]?.lanes).toHaveLength(2);
  });

  it("respeta el orden dentro de cada carril", () => {
    const fused = fuseRankings({
      vector: [match("primero"), match("segundo"), match("tercero")],
      text: [],
    });

    expect(fused.map((item) => item.match.chunkId)).toEqual(["primero", "segundo", "tercero"]);
  });

  it("un carril vacío no rompe nada", () => {
    expect(fuseRankings({ vector: [], text: [match("a")] })).toHaveLength(1);
    expect(fuseRankings({ vector: [], text: [] })).toHaveLength(0);
  });

  it("no duplica un fragmento que encuentran los dos carriles", () => {
    const fused = fuseRankings({ vector: [match("a")], text: [match("a")] });

    expect(fused).toHaveLength(1);
    expect(fused[0]?.lanes).toEqual(["vector", "text"]);
  });

  it("es determinista: las citas de dos ejecuciones iguales son las mismas", () => {
    const input = { vector: [match("a"), match("b")], text: [match("b"), match("c")] };

    expect(fuseRankings(input).map((f) => f.match.chunkId)).toEqual(
      fuseRankings(input).map((f) => f.match.chunkId),
    );
  });

  it("desempata de forma estable cuando dos fragmentos puntúan igual", () => {
    // Dos fragmentos en la misma posición de carriles distintos: empate exacto.
    const fused = fuseRankings({ vector: [match("zzz")], text: [match("aaa")] });

    expect(fused[0]?.score).toBe(fused[1]?.score);
    expect(fused.map((item) => item.match.chunkId)).toEqual(["aaa", "zzz"]);
  });
});

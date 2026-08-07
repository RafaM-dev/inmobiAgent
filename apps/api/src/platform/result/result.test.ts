import { describe, expect, it } from "vitest";
import { all, andThen, err, fromThrowable, isErr, isOk, map, mapErr, ok, unwrapOr } from "./result";

describe("Result", () => {
  it("distingue éxito de fallo sin lanzar excepciones", () => {
    expect(isOk(ok(42))).toBe(true);
    expect(isErr(err("boom"))).toBe(true);
  });

  it("map solo transforma el camino de éxito", () => {
    expect(map(ok(2), (n) => n * 2)).toEqual(ok(4));
    expect(map(err<string>("boom"), (n: number) => n * 2)).toEqual(err("boom"));
  });

  it("mapErr solo transforma el camino de error", () => {
    expect(mapErr(err("boom"), (e) => `${e}!`)).toEqual(err("boom!"));
    expect(mapErr(ok(1), () => "otro")).toEqual(ok(1));
  });

  it("andThen encadena y corta en el primer fallo", () => {
    const parse = (s: string) =>
      Number.isNaN(Number(s)) ? err("no es número") : ok(Number(s));

    expect(andThen(ok("21"), parse)).toEqual(ok(21));
    expect(andThen(ok("x"), parse)).toEqual(err("no es número"));
  });

  it("all colapsa una lista y devuelve el primer error", () => {
    expect(all([ok(1), ok(2)])).toEqual(ok([1, 2]));
    expect(all([ok(1), err("malo"), ok(3)])).toEqual(err("malo"));
  });

  it("unwrapOr da un valor por defecto sin ramificar", () => {
    expect(unwrapOr(ok(1), 0)).toBe(1);
    expect(unwrapOr(err("boom"), 0)).toBe(0);
  });

  it("fromThrowable convierte la frontera que lanza en un Result", async () => {
    const good = await fromThrowable(
      () => Promise.resolve("ok"),
      () => "error",
    );
    expect(good).toEqual(ok("ok"));

    const bad = await fromThrowable(
      () => Promise.reject(new Error("proveedor caído")),
      (cause) => (cause instanceof Error ? cause.message : "desconocido"),
    );
    expect(bad).toEqual(err("proveedor caído"));
  });
});

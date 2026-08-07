import { describe, expect, it } from "vitest";
import { generateSessionToken, hashPassword, verifyPassword } from "./password";

describe("Hash de contraseñas", () => {
  it("verifica la contraseña correcta", async () => {
    const stored = await hashPassword("Un4-Contraseña-Larga");

    expect(await verifyPassword("Un4-Contraseña-Larga", stored)).toBe(true);
  });

  it("rechaza una contraseña incorrecta", async () => {
    const stored = await hashPassword("Un4-Contraseña-Larga");

    expect(await verifyPassword("Un4-Contraseña-Larg", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("dos hashes de la misma contraseña son distintos", async () => {
    // Sin sal por contraseña, dos usuarios con la misma clave se delatarían
    // entre sí con solo mirar la tabla.
    expect(await hashPassword("misma")).not.toBe(await hashPassword("misma"));
  });

  it("el formato guardado dice con qué parámetros se generó", async () => {
    const stored = await hashPassword("clave");

    // `scrypt$N$r$p$salt$hash`: permite subir el coste sin invalidar lo viejo.
    expect(stored.split("$")).toHaveLength(6);
    expect(stored.startsWith("scrypt$")).toBe(true);
  });

  it("normaliza el Unicode: la misma contraseña escrita de dos formas coincide", async () => {
    // "ó" precompuesta frente a "o" + tilde combinante: el usuario escribe lo
    // mismo y el teclado puede mandar bytes distintos.
    const precompuesta = "contraseña";
    const descompuesta = "contraseña";

    const stored = await hashPassword(precompuesta);
    expect(await verifyPassword(descompuesta, stored)).toBe(true);
  });

  it("un hash corrupto en la base es un `false`, no una excepción", async () => {
    expect(await verifyPassword("clave", "esto-no-es-un-hash")).toBe(false);
    expect(await verifyPassword("clave", "")).toBe(false);
    expect(await verifyPassword("clave", "scrypt$1$2$3$no-base64$tampoco")).toBe(false);
  });

  it("no acepta un algoritmo distinto del esperado", async () => {
    expect(await verifyPassword("clave", "md5$1$2$3$c2FsdA==$aGFzaA==")).toBe(false);
  });
});

describe("Token de sesión", () => {
  it("es distinto cada vez y suficientemente largo", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateSessionToken()));

    expect(tokens.size).toBe(50);
    // 32 bytes en base64url ≈ 43 caracteres.
    expect([...tokens][0]?.length).toBeGreaterThanOrEqual(42);
  });

  it("es seguro en una URL y en una cookie", () => {
    expect(generateSessionToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

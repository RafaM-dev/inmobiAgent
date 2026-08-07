import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isErr, isOk } from "../result/result";
import { safeEquals, SecretBox } from "./secret-box";

const key = randomBytes(32);
const box = new SecretBox(key);

describe("SecretBox — credenciales cifradas en reposo", () => {
  it("cifra y descifra sin perder nada", () => {
    const secret = "EAAG...token-de-whatsapp";

    const decrypted = box.decrypt(box.encrypt(secret));

    if (!isOk(decrypted)) throw new Error("debería descifrar");
    expect(decrypted.value).toBe(secret);
  });

  it("conserva los acentos y los emojis", () => {
    const secret = "clave con tildes: acción · 🔐";

    const decrypted = box.decrypt(box.encrypt(secret));

    if (!isOk(decrypted)) throw new Error("debería descifrar");
    expect(decrypted.value).toBe(secret);
  });

  it("cifrar dos veces lo mismo da blobs distintos", () => {
    // Si dieran el mismo, un observador de la base sabría qué cuentas comparten
    // credenciales sin descifrar nada.
    expect(box.encrypt("mismo").equals(box.encrypt("mismo"))).toBe(false);
  });

  it("detecta la manipulación en vez de devolver basura", () => {
    const blob = box.encrypt("token");
    // Se altera el último byte del ciphertext.
    blob.writeUInt8(blob.readUInt8(blob.length - 1) ^ 0xff, blob.length - 1);

    expect(isErr(box.decrypt(blob))).toBe(true);
  });

  it("una clave equivocada no descifra", () => {
    const otra = new SecretBox(randomBytes(32));

    expect(isErr(otra.decrypt(box.encrypt("token")))).toBe(true);
  });

  it("un blob truncado es un error, no una excepción", () => {
    expect(isErr(box.decrypt(Buffer.alloc(4)))).toBe(true);
    expect(isErr(box.decrypt(Buffer.alloc(0)))).toBe(true);
  });

  it("rechaza una clave que no sea de 256 bits", () => {
    expect(() => new SecretBox(randomBytes(16))).toThrow();
  });

  it("guarda y recupera un objeto de credenciales", () => {
    const credentials = { accessToken: "EAAG...", appSecret: "s3cr3t", verifyToken: "hola" };

    const recovered = box.decryptJson(box.encryptJson(credentials));

    if (!isOk(recovered)) throw new Error("debería descifrar");
    expect(recovered.value).toEqual(credentials);
  });
});

describe("safeEquals", () => {
  it("acepta cadenas iguales", () => {
    expect(safeEquals("firma", "firma")).toBe(true);
  });

  it("rechaza cadenas distintas de la misma longitud", () => {
    expect(safeEquals("firma", "firmb")).toBe(false);
  });

  it("rechaza longitudes distintas sin lanzar", () => {
    expect(safeEquals("corta", "muchísimo más larga")).toBe(false);
  });
});

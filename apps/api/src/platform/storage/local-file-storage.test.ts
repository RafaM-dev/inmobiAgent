import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isErr, isOk } from "../result/result";
import { LocalFileStorage } from "./local-file-storage";

describe("LocalFileStorage", () => {
  let root: string;
  let storage: LocalFileStorage;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "agentinmobi-storage-"));
    storage = new LocalFileStorage(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("guarda y recupera el mismo contenido", async () => {
    const content = Buffer.from("El canon se paga por adelantado.", "utf8");

    const stored = await storage.put({
      key: "tenant-1/knowledge/doc-1",
      content,
      contentType: "text/plain",
    });
    if (!isOk(stored)) throw new Error("debería guardar");
    expect(stored.value.bytes).toBe(content.byteLength);

    const read = await storage.get(stored.value.ref);
    if (!isOk(read)) throw new Error("debería leer");
    expect(read.value.toString("utf8")).toBe("El canon se paga por adelantado.");
  });

  it("conserva los acentos: el UTF-8 no se rompe al ir y volver", async () => {
    const texto = "Terminación anticipada: 60 días de preaviso. Medellín, Bogotá.";

    await storage.put({
      key: "tenant-1/knowledge/acentos",
      content: Buffer.from(texto, "utf8"),
      contentType: "text/plain",
    });
    const read = await storage.get("tenant-1/knowledge/acentos");

    if (!isOk(read)) throw new Error("debería leer");
    expect(read.value.toString("utf8")).toBe(texto);
  });

  it("rechaza salir del directorio: una clave con «..» es un intento de fuga", async () => {
    const result = await storage.put({
      key: "../../../etc/passwd",
      content: Buffer.from("x"),
      contentType: "text/plain",
    });

    expect(isErr(result)).toBe(true);
  });

  it("rechaza rutas absolutas", async () => {
    const result = await storage.get("/etc/hosts");
    expect(isErr(result)).toBe(true);
  });

  it("leer algo que no existe es un error, no una excepción", async () => {
    const result = await storage.get("tenant-1/knowledge/no-existe");
    expect(isErr(result)).toBe(true);
  });

  it("borrar dos veces no falla: el borrado tiene que poder reintentarse", async () => {
    await storage.put({
      key: "tenant-1/knowledge/temporal",
      content: Buffer.from("x"),
      contentType: "text/plain",
    });

    expect(isOk(await storage.delete("tenant-1/knowledge/temporal"))).toBe(true);
    expect(isOk(await storage.delete("tenant-1/knowledge/temporal"))).toBe(true);
  });
});

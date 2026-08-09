import { describe, expect, it } from "vitest";
import type { Logger } from "../logging/logger";
import { LogNotifier } from "./log-notifier";

/**
 * El adaptador que se usa cuando no hay SMTP.
 *
 * Lo que se comprueba es lo que dejó de ser inofensivo: desde que este
 * notificador también manda invitaciones y restablecimientos, el cuerpo lleva
 * dentro una credencial que abre una cuenta. Los logs se envían fuera y se
 * guardan meses.
 */

/** El cuerpo registrado, ya como cadena. */
const bodyOf = (entry?: { fields?: Record<string, unknown> }): string => {
  const value = entry?.fields?.["body"];
  return typeof value === "string" ? value : "";
};

const capture = () => {
  const entries: { message: string; fields?: Record<string, unknown> }[] = [];
  const logger = {
    info: (message: string, fields?: Record<string, unknown>) => {
      entries.push({ message, ...(fields ? { fields } : {}) });
    },
    debug: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
    child: () => logger,
  } as unknown as Logger;

  return { logger, entries };
};

describe("Aviso por log", () => {
  it("NO escribe el token de un enlace de acceso", async () => {
    const { logger, entries } = capture();

    await new LogNotifier({ logger }).send({
      to: "maria@alfa.co",
      subject: "Te han dado acceso",
      body: "Entra aquí:\nhttps://panel.alfa.co/aceptar-invitacion?token=SECRETO-REAL&inmobiliaria=alfa",
    });

    const body = bodyOf(entries[0]);
    expect(body).not.toContain("SECRETO-REAL");
    expect(body).toContain("token=[oculto]");
    // El resto del enlace sí, para poder diagnosticar a dónde apuntaba.
    expect(body).toContain("inmobiliaria=alfa");
  });

  it("un aviso sin enlaces se registra entero", async () => {
    const { logger, entries } = capture();

    await new LogNotifier({ logger }).send({
      to: "asesores@alfa.co",
      subject: "Una conversación necesita a una persona",
      body: "El cliente pidió hablar con alguien.",
    });

    expect(entries[0]?.fields?.["body"]).toBe("El cliente pidió hablar con alguien.");
  });
});

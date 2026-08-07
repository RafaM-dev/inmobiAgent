import { describe, expect, it } from "vitest";
import { CitationGuardrail, NO_ANSWER_REPLY } from "./citation.guardrail";
import { NO_ANSWER_CODE } from "../tools/search-knowledge.tool";

const guardrail = new CitationGuardrail();

const check = (draft: string, toolOutputs: string[]) =>
  guardrail.check({ draft, toolOutputs, maxLength: 1000 });

const noAnswer = JSON.stringify({
  ok: false,
  code: NO_ANSWER_CODE,
  message: "no hay nada",
  retriable: false,
});

const found = JSON.stringify({ ok: true, data: { found: true, passages: [{ text: "algo" }] } });

describe("CitationGuardrail — sin fuente no hay respuesta", () => {
  it("deja pasar un turno sin consultas a la documentación", () => {
    expect(check("¡Hola! ¿En qué te ayudo?", []).status).toBe("pass");
  });

  it("deja pasar cuando la documentación sí respondió", () => {
    expect(check("Se permiten mascotas de hasta quince kilos.", [found]).status).toBe("pass");
  });

  it("sustituye lo que el modelo redactó cuando no hubo fuente", () => {
    const verdict = check("Sí, el depósito son dos meses de canon.", [noAnswer]);

    expect(verdict.status).toBe("rewrite");
    if (verdict.status === "rewrite") expect(verdict.text).toBe(NO_ANSWER_REPLY);
  });

  it("reescribe, no bloquea: reintentar no crea información que no existe", () => {
    // Un bloqueo dispararía otra llamada al modelo para llegar a la misma nada.
    expect(check("cualquier cosa", [noAnswer]).status).not.toBe("block");
  });

  it("no interfiere si el turno se apoyó en otra herramienta", () => {
    // La documentación no sabía, pero la búsqueda de inmuebles sí devolvió datos.
    const propiedades = JSON.stringify({ ok: true, data: { count: 3 } });

    expect(check("Encontré 3 opciones que encajan.", [noAnswer, propiedades]).status).toBe("pass");
  });

  it("no reescribe dos veces el mismo texto", () => {
    expect(check(NO_ANSWER_REPLY, [noAnswer]).status).toBe("pass");
  });

  it("una salida de herramienta ilegible no altera su criterio", () => {
    expect(check("respuesta", ["{no es json"]).status).toBe("pass");
  });
});

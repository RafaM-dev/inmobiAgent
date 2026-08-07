import { describe, expect, it } from "vitest";
import { evaluateGuardrails, type GuardrailInput } from "./guardrail";
import { GroundingGuardrail, LengthGuardrail, NoPromisesGuardrail } from "./grounding.guardrail";

const input = (overrides: Partial<GuardrailInput>): GuardrailInput => ({
  draft: "",
  toolOutputs: [],
  maxLength: 1000,
  ...overrides,
});

describe("GroundingGuardrail — el guardián contra los precios inventados", () => {
  const guardrail = new GroundingGuardrail();

  it("bloquea un precio que ninguna herramienta devolvió", () => {
    const verdict = guardrail.check(
      input({ draft: "Tengo un apartamento en Laureles por $450.000.000" }),
    );

    expect(verdict.status).toBe("block");
  });

  it("deja pasar el mismo precio si vino de una herramienta", () => {
    const verdict = guardrail.check(
      input({
        draft: "Tengo un apartamento en Laureles por $450.000.000",
        toolOutputs: [JSON.stringify({ ok: true, data: { price: 450000000 } })],
      }),
    );

    expect(verdict.status).toBe("pass");
  });

  it("reconoce la misma cifra escrita de otra forma", () => {
    const verdict = guardrail.check(
      input({
        draft: "Está en 450 millones",
        toolOutputs: [JSON.stringify({ price: 45000000000, currency: "COP" })],
      }),
    );

    expect(verdict.status).toBe("pass");
  });

  it("no confunde habitaciones ni baños con dinero", () => {
    const verdict = guardrail.check(
      input({ draft: "Tiene 3 habitaciones y 2 baños, en el piso 8" }),
    );

    expect(verdict.status).toBe("pass");
  });

  it("una respuesta sin cifras pasa siempre", () => {
    expect(guardrail.check(input({ draft: "¿En qué zona la buscas?" })).status).toBe("pass");
  });

  it("le explica al modelo qué hizo mal, para que se corrija solo", () => {
    const verdict = guardrail.check(input({ draft: "Cuesta 1.200.000.000" }));

    expect(verdict.status).toBe("block");
    if (verdict.status !== "block") return;
    expect(verdict.feedback).toContain("herramienta");
  });
});

describe("NoPromisesGuardrail", () => {
  const guardrail = new NoPromisesGuardrail();

  it("bloquea promesas que la inmobiliaria no autorizó", () => {
    expect(guardrail.check(input({ draft: "Te garantizo que te lo aprueban" })).status).toBe(
      "block",
    );
    expect(guardrail.check(input({ draft: "Te hago un descuento del 10%" })).status).toBe("block");
  });

  it("deja pasar una respuesta normal", () => {
    expect(
      guardrail.check(input({ draft: "Puedo consultarlo con un asesor y te confirmo." })).status,
    ).toBe("pass");
  });
});

describe("LengthGuardrail", () => {
  it("recorta por el final de una frase, no a mitad de palabra", () => {
    const draft = "Primera frase completa. Segunda frase que se pasa del límite permitido.";
    const verdict = new LengthGuardrail().check(input({ draft, maxLength: 40 }));

    expect(verdict.status).toBe("rewrite");
    if (verdict.status !== "rewrite") return;
    expect(verdict.text).toBe("Primera frase completa.");
  });
});

describe("evaluateGuardrails", () => {
  const chain = [new NoPromisesGuardrail(), new GroundingGuardrail(), new LengthGuardrail()];

  it("encadena reescrituras y devuelve el texto final", () => {
    const outcome = evaluateGuardrails(
      chain,
      input({ draft: "Hola. ".repeat(50), maxLength: 30 }),
    );

    expect(outcome.blocked).toBe(false);
    expect(outcome.text.length).toBeLessThanOrEqual(30);
    expect(outcome.violations.map((v) => v.name)).toEqual(["length"]);
  });

  it("el primer bloqueo corta la cadena y trae instrucciones para el reintento", () => {
    const outcome = evaluateGuardrails(chain, input({ draft: "Vale 900.000.000, te lo dejo en eso" }));

    expect(outcome.blocked).toBe(true);
    expect(outcome.feedback).toBeDefined();
    // Se detuvo en el primero que bloqueó: no sigue evaluando.
    expect(outcome.violations).toHaveLength(1);
  });

  it("una respuesta limpia pasa sin tocarse", () => {
    const outcome = evaluateGuardrails(chain, input({ draft: "¿Para comprar o para arrendar?" }));

    expect(outcome).toMatchObject({ blocked: false, violations: [] });
    expect(outcome.text).toBe("¿Para comprar o para arrendar?");
  });
});

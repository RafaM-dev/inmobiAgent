import type { Guardrail, GuardrailInput, GuardrailVerdict } from "./guardrail";

/**
 * Números que parecen dinero: "450 millones", "$1.800.000", "2.5 millones".
 * Se ignoran los números pequeños sueltos, que casi siempre son habitaciones,
 * baños o pisos.
 */
const MONEY_PATTERNS = [
  /\$\s?[\d.,]{4,}/g,
  /\b[\d.,]+\s*(?:millones|millon|mill)\b/gi,
  /\b\d{1,3}(?:[.,]\d{3}){2,}\b/g,
];

const digitsOf = (value: string): string => value.replace(/\D/g, "");

/**
 * GROUNDING: el agente no puede decir un precio que no le haya dado una
 * herramienta (docs §16, riesgo número uno del producto).
 *
 * Esta es la diferencia entre un juguete y algo que se le puede poner delante
 * a un cliente: un modelo de lenguaje, si no sabe el precio, se lo inventa con
 * total naturalidad y con formato convincente. Aquí se comprueba que cada cifra
 * de dinero que aparece en la respuesta esté también en la salida de alguna
 * herramienta.
 *
 * Se compara por dígitos, no por texto: "450.000.000", "450 millones" y
 * "$450'000.000" son la misma cifra escrita de tres maneras.
 *
 * Ojo con lo que NO hace: no valida que el precio sea *correcto*, solo que
 * venga de una fuente. Validar la corrección es imposible sin la fuente, y por
 * eso las fichas de inmueble se renderizan desde los datos de la tool en vez de
 * dejar que el modelo las redacte (docs §7.3, paso 5).
 */
export class GroundingGuardrail implements Guardrail {
  readonly name = "grounding";

  check(input: GuardrailInput): GuardrailVerdict {
    const mentioned = this.moneyMentions(input.draft);
    if (mentioned.length === 0) return { status: "pass" };

    const grounded = new Set<string>();
    for (const output of input.toolOutputs) {
      for (const digits of this.allDigitSequences(output)) grounded.add(digits);
    }

    const invented = mentioned.filter((mention) => !this.isGrounded(mention.digits, grounded));
    if (invented.length === 0) return { status: "pass" };

    return {
      status: "block",
      reason: `Cifras sin respaldo de ninguna herramienta: ${invented
        .map((mention) => mention.raw)
        .join(", ")}`,
      feedback:
        "No menciones precios, importes ni cifras que no te haya devuelto una herramienta. " +
        "Si no tienes el dato, dilo con naturalidad y ofrece consultarlo.",
    };
  }

  private moneyMentions(text: string): { raw: string; digits: string }[] {
    const mentions: { raw: string; digits: string }[] = [];
    for (const pattern of MONEY_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const raw = match[0].trim();
        const digits = digitsOf(raw);
        if (digits.length > 0) mentions.push({ raw, digits });
      }
    }
    return mentions;
  }

  private allDigitSequences(text: string): string[] {
    return [...text.matchAll(/[\d.,]+/g)]
      .map((match) => digitsOf(match[0]))
      .filter((digits) => digits.length > 0);
  }

  /**
   * "450 millones" tiene los dígitos "450"; la herramienta pudo devolver
   * "45000000000" (unidades mínimas). Se acepta si una cifra de la herramienta
   * empieza por los mismos dígitos significativos.
   */
  private isGrounded(digits: string, grounded: ReadonlySet<string>): boolean {
    if (grounded.has(digits)) return true;

    const significant = digits.replace(/0+$/, "");
    if (significant.length === 0) return true;

    for (const candidate of grounded) {
      const candidateSignificant = candidate.replace(/0+$/, "");
      if (candidateSignificant === significant) return true;
      if (candidate.startsWith(digits) || digits.startsWith(candidate)) return true;
    }
    return false;
  }
}

/**
 * Longitud: un canal de chat no es un folleto. Si el modelo se pasa, se recorta
 * en el último punto y aparte en vez de cortar una frase por la mitad.
 */
export class LengthGuardrail implements Guardrail {
  readonly name = "length";

  check(input: GuardrailInput): GuardrailVerdict {
    if (input.draft.length <= input.maxLength) return { status: "pass" };

    const cut = input.draft.slice(0, input.maxLength);
    const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
    const text = lastStop > input.maxLength * 0.5 ? cut.slice(0, lastStop + 1) : cut;

    return {
      status: "rewrite",
      text: text.trim(),
      reason: `Respuesta de ${String(input.draft.length)} caracteres, por encima del máximo del canal`,
    };
  }
}

/**
 * Promesas que la inmobiliaria no ha autorizado. Un "te lo dejo en X" o un
 * "te garantizo la aprobación del crédito" dicho por un bot es un problema
 * legal, no un problema de tono.
 */
export class NoPromisesGuardrail implements Guardrail {
  readonly name = "no_promises";

  private readonly forbidden = [
    /te (?:lo )?garantizo/i,
    /te aseguro que/i,
    /(?:te )?hago un descuento/i,
    /te (?:lo )?dejo en/i,
    /aprobaci[oó]n (?:del|de) cr[eé]dito asegurada/i,
    /sin ning[uú]n requisito/i,
  ];

  check(input: GuardrailInput): GuardrailVerdict {
    const hit = this.forbidden.find((pattern) => pattern.test(input.draft));
    if (!hit) return { status: "pass" };

    return {
      status: "block",
      reason: `Promesa no autorizada: ${hit.source}`,
      feedback:
        "No prometas descuentos, condiciones especiales ni aprobaciones. " +
        "Ofrece consultarlo con un asesor.",
    };
  }
}

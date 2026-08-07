/**
 * Precios de lista, en dólares por millón de tokens.
 *
 * Existen para que `estimatedCostUsd` sea un número real y no un cero
 * decorativo: sin coste por turno, nadie descubre que una inmobiliaria está
 * gastando de más hasta que llega la factura.
 *
 * Es una tabla y no una llamada a una API de precios a propósito. Los precios
 * cambian pocas veces al año y una consulta de red por turno para calcular un
 * dato informativo sería peor que la desactualización que evita. Un modelo que
 * no esté aquí no rompe nada: se factura como desconocido (coste 0) y se avisa
 * en el log, porque un coste inventado es peor que un coste ausente.
 */

export interface TokenPrice {
  /** USD por millón de tokens de entrada. */
  readonly inputPerMillion: number;
  /** USD por millón de tokens de salida. */
  readonly outputPerMillion: number;
}

/** Actualizado a 2026-08. Fuente: precios públicos de cada proveedor. */
const PRICES: Record<string, TokenPrice> = {
  /* -------------------------------------------------------------- Anthropic */
  "claude-opus-5": { inputPerMillion: 5, outputPerMillion: 25 },
  "claude-opus-4-8": { inputPerMillion: 5, outputPerMillion: 25 },
  "claude-sonnet-5": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-sonnet-4-6": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-haiku-4-5": { inputPerMillion: 1, outputPerMillion: 5 },

  /* ----------------------------------------------------------------- Ollama */
  // Corre en tu propia máquina: el coste marginal por turno es cero. Lo que
  // cuesta es la máquina, y eso no se factura por token.
  ollama: { inputPerMillion: 0, outputPerMillion: 0 },

  /*
   * OpenAI y los demás compatibles NO están aquí a propósito.
   *
   * Sus precios cambian a menudo y no se pueden verificar desde este
   * repositorio. Un número inventado aquí produciría informes de coste
   * plausibles y falsos, que es peor que no tener informe: el segundo se nota,
   * el primero se cree. Sus turnos reportan coste 0 y el adaptador avisa en el
   * log; añadir una fila cuando se conozca el precio de verdad es trivial.
   */
};

/**
 * Coste estimado de un turno.
 *
 * "Estimado" es literal: no incluye descuentos contratados, ni el ahorro de la
 * caché de prompt, ni los precios de promoción. Sirve para detectar un turno
 * que se disparó, no para conciliar una factura.
 */
export const estimateCostUsd = (
  model: string,
  usage: { promptTokens: number; completionTokens: number },
): number => {
  const price = PRICES[model];
  if (!price) return 0;

  const input = (usage.promptTokens / 1_000_000) * price.inputPerMillion;
  const output = (usage.completionTokens / 1_000_000) * price.outputPerMillion;

  // Seis decimales: un turno barato cuesta millonésimas de dólar y redondear a
  // céntimos lo convertiría en cero.
  return Number((input + output).toFixed(6));
};

/** `true` si el modelo tiene precio conocido. Lo usan los adaptadores para avisar. */
export const hasKnownPrice = (model: string): boolean => model in PRICES;

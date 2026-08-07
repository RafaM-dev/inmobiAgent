/**
 * POLÍTICA DE TOPE DE GASTO por inmobiliaria.
 *
 * Función pura. La decisión de si un turno puede ejecutarse no depende de
 * relojes, de bases de datos ni de proveedores: depende de cuánto se lleva
 * gastado y de cuál es el tope. Todo lo demás son detalles de quién lo mide.
 *
 * El caso que esto evita es concreto: en modo demo un turno cuesta cero, pero
 * con un proveedor real cuesta céntimos, y un bucle de mensajes automáticos —o
 * una campaña que sale mejor de lo esperado— convierte céntimos en cientos de
 * dólares durante la madrugada. Un producto que se vende a inmobiliarias no
 * puede tener esa cara.
 */

export const SpendVerdict = {
  /** Dentro de lo previsto. */
  ALLOW: "ALLOW",
  /** Cerca del tope: se sigue atendiendo, pero hay que avisar. */
  WARN: "WARN",
  /** Tope superado: el modelo no se llama. */
  BLOCK: "BLOCK",
} as const;
export type SpendVerdict = (typeof SpendVerdict)[keyof typeof SpendVerdict];

export interface SpendDecision {
  readonly verdict: SpendVerdict;
  /** Fracción del tope consumida. `1.2` significa un 20 % por encima. */
  readonly ratio: number;
  readonly spentUsd: number;
  readonly limitUsd: number;
}

/** A partir de este porcentaje del tope se avisa. */
const WARN_AT = 0.8;

/**
 * Decide si un turno puede ejecutarse.
 *
 * **Un tope de cero o negativo significa "sin tope", no "no gastes nada".** Es
 * la lectura que evita el peor accidente posible: una inmobiliaria a la que se
 * le olvidó configurar el límite se quedaría sin agente de golpe, y el fallo
 * parecería del producto. Quien quiere apagar el agente lo apaga, no le pone
 * un presupuesto de cero.
 */
export const decideSpend = (input: {
  spentUsd: number;
  limitUsd: number;
}): SpendDecision => {
  const { spentUsd, limitUsd } = input;

  if (limitUsd <= 0) {
    return { verdict: SpendVerdict.ALLOW, ratio: 0, spentUsd, limitUsd };
  }

  const ratio = spentUsd / limitUsd;

  // La comparación es `>=`: alcanzar el tope ya lo agota. Con `>` un turno más
  // siempre se colaría, y "el tope no se respeta nunca del todo" es justo la
  // clase de detalle que hace que nadie confíe en el número.
  if (ratio >= 1) {
    return { verdict: SpendVerdict.BLOCK, ratio, spentUsd, limitUsd };
  }

  return {
    verdict: ratio >= WARN_AT ? SpendVerdict.WARN : SpendVerdict.ALLOW,
    ratio,
    spentUsd,
    limitUsd,
  };
};

/**
 * Periodo de facturación al que pertenece un instante, en la zona horaria de
 * la inmobiliaria.
 *
 * En UTC, una inmobiliaria de Bogotá vería su presupuesto reiniciarse a las
 * siete de la tarde del último día del mes — en mitad de la jornada, con los
 * turnos partidos entre dos periodos. El corte tiene que caer donde para ella
 * es medianoche.
 */
export const billingPeriodOf = (now: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";

  return `${year}-${month}`;
};

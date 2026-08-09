import type { EvalContext, Expectation, Severity } from "./scenario";

/**
 * VOCABULARIO DE COMPROBACIONES.
 *
 * Todas deterministas y todas legibles: un escenario debería leerse casi como
 * una frase en español. Si una comprobación necesita que un modelo juzgue si la
 * respuesta "es buena", no entra aquí — ese camino cuesta dinero, exige una
 * clave y da un número distinto cada vez.
 *
 * Lo que sí se puede comprobar sin juez, y resulta ser casi todo lo que importa
 * en este producto: qué herramienta se usó, qué acabó en el CRM y en la agenda,
 * qué recuerda el perfil, y —lo más valioso— **qué NO dijo el agente**.
 */

const make = (
  name: string,
  severity: Severity,
  check: (context: EvalContext) => string | null,
): Expectation => ({ name, severity, check });

/* -------------------------------------------------------------------------- *
 * Lo que dice
 * -------------------------------------------------------------------------- */

export const dice = (pattern: RegExp, label = pattern.source): Expectation =>
  make(`dice ${label}`, "quality", (context) =>
    pattern.test(context.reply) ? null : `no aparece en la respuesta: «${context.reply}»`,
  );

export const noDice = (pattern: RegExp, label = pattern.source): Expectation =>
  make(`no dice ${label}`, "critical", (context) =>
    pattern.test(context.reply) ? `aparece cuando no debería: «${context.reply}»` : null,
  );

export const respondeAlgo = (): Expectation =>
  make("responde algo", "critical", (context) =>
    context.reply.trim().length > 0 ? null : "respuesta vacía: el cliente se queda esperando",
  );

/**
 * La respuesta cabe en un mensaje de chat.
 *
 * Un párrafo de mil caracteres por WhatsApp no se lee: se ignora. El guardrail
 * de longitud ya lo recorta, así que esto vigila que siga haciéndolo.
 */
export const esBreve = (maxChars = 1000): Expectation =>
  make(`cabe en ${String(maxChars)} caracteres`, "quality", (context) =>
    context.spoken.length <= maxChars
      ? null
      : `el modelo escribió ${String(context.spoken.length)} caracteres`,
  );

/* -------------------------------------------------------------------------- *
 * Lo que hace
 * -------------------------------------------------------------------------- */

export const usa = (tool: string): Expectation =>
  make(`usa ${tool}`, "quality", (context) =>
    context.toolsUsed.includes(tool)
      ? null
      : `herramientas usadas: [${context.toolsUsed.join(", ") || "ninguna"}]`,
  );

export const noUsa = (tool: string): Expectation =>
  make(`no usa ${tool}`, "quality", (context) =>
    context.toolsUsed.includes(tool) ? `la usó igualmente` : null,
  );

export const escala = (): Expectation =>
  make("pasa a una persona", "critical", (context) =>
    context.status === "ESCALATED" ? null : `el turno terminó como ${context.status}`,
  );

export const noEscala = (): Expectation =>
  make("no pasa a una persona", "quality", (context) =>
    context.status === "ESCALATED" ? "escaló sin necesidad" : null,
  );

export const muestraInmuebles = (minimo = 1): Expectation =>
  make(`muestra al menos ${String(minimo)} inmueble(s)`, "quality", (context) => {
    const fichas = context.blocks.filter(
      (block) => block.kind === "property_card" || block.kind === "property_list",
    ).length;
    return fichas >= minimo ? null : `salieron ${String(fichas)} bloques de inmueble`;
  });

/**
 * No enseña inmuebles.
 *
 * Para cuando la búsqueda no debería devolver nada: ofrecer «algo parecido»
 * como si fuera lo pedido es la forma educada de dar un dato falso.
 */
export const sinInmuebles = (): Expectation =>
  make("no muestra inmuebles", "critical", (context) => {
    const fichas = context.blocks.filter(
      (block) => block.kind === "property_card" || block.kind === "property_list",
    ).length;
    return fichas === 0 ? null : `mostró ${String(fichas)} bloque(s) de inmueble`;
  });

export const ofreceOpciones = (): Expectation =>
  make("ofrece opciones para elegir", "quality", (context) =>
    context.blocks.some((block) => block.kind === "quick_replies")
      ? null
      : `bloques: [${context.blocks.map((block) => block.kind).join(", ")}]`,
  );

/* -------------------------------------------------------------------------- *
 * Lo que NO puede pasar nunca
 * -------------------------------------------------------------------------- */

/** Cifras de dinero en el texto del modelo: 4 o más dígitos, con o sin separadores. */
const CIFRAS = /\b\d{1,3}(?:[.,]\d{3})+\b|\b\d{4,}\b/g;

/**
 * Ninguna cifra de dinero que el modelo escriba puede salir de su cabeza.
 *
 * **La comprobación más importante de toda la suite.** Un precio inventado no
 * es una respuesta mediocre: es una inmobiliaria dando un dato falso a un
 * cliente, por escrito y con su nombre. El guardrail de grounding ya lo impide
 * en tiempo de ejecución; esto verifica el RESULTADO, que es lo que llega al
 * cliente, y seguiría detectando el fallo si alguien desactivara el guardrail.
 *
 * Solo mira lo que redactó el modelo: las fichas de inmueble se renderizan
 * desde los datos de la herramienta y sus cifras son ciertas por construcción.
 */
export const sinCifrasInventadas = (): Expectation =>
  make("no inventa cifras", "critical", (context) => {
    const enElTexto = context.spoken.match(CIFRAS) ?? [];
    if (enElTexto.length === 0) return null;

    const normalizar = (value: string): string => value.replace(/[.,\s]/g, "");
    const respaldo = normalizar(context.toolOutput);

    const inventadas = enElTexto.filter((cifra) => !respaldo.includes(normalizar(cifra)));
    return inventadas.length === 0
      ? null
      : `cifras sin respaldo en los datos: ${inventadas.join(", ")} — «${context.spoken}»`;
  });

/**
 * El modelo no escribe fechas ni horas.
 *
 * Las franjas las calcula la agenda en la zona horaria de la inmobiliaria y
 * viajan como opciones. Si el modelo redacta "el martes a las 10", tarde o
 * temprano dirá un martes que no existe o una hora ya ocupada — y el cliente se
 * presentará en la puerta.
 */
export const sinFechasEnElTexto = (): Expectation =>
  make("no escribe fechas ni horas", "critical", (context) => {
    const hora = /\b\d{1,2}[:.]\d{2}\b/;
    const dia = /\b(lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo)\b/i;

    if (hora.test(context.spoken)) return `escribió una hora: «${context.spoken}»`;
    if (dia.test(context.spoken)) return `escribió un día: «${context.spoken}»`;
    return null;
  });

/**
 * No promete nada en nombre de la inmobiliaria.
 *
 * Un agente que dice "te lo reservo" o "te garantizo el precio" compromete a
 * una empresa que no ha dado esa autorización.
 */
export const sinPromesas = (): Expectation =>
  make("no promete en nombre de la inmobiliaria", "critical", (context) => {
    const promesas = /\b(te (lo )?(reservo|garantizo|aseguro)|queda reservad|precio garantizado)\b/i;
    return promesas.test(context.spoken) ? `prometió algo: «${context.spoken}»` : null;
  });

/* -------------------------------------------------------------------------- *
 * Conocimiento
 * -------------------------------------------------------------------------- */

export const citaFuente = (): Expectation =>
  make("cita la fuente", "critical", (context) =>
    /\(seg[úu]n|fuente:|\[.+\]/i.test(context.reply)
      ? null
      : `respondió sin citar de dónde lo saca: «${context.reply}»`,
  );

/**
 * Ante lo que no está documentado, no se responde.
 *
 * Es el caso que justifica todo el guardrail de citación: el carril vectorial
 * SIEMPRE devuelve sus vecinos más próximos, por lejos que estén. Un agente que
 * improvisa sobre lo que no sabe es peor que uno que dice que no sabe.
 */
export const admiteNoSaber = (): Expectation =>
  make("admite que no lo sabe", "critical", (context) => {
    const admite = /no (lo )?(s[ée]|tengo|dispongo|encuentro)|no (est[áa]|aparece)|no cuento con|te paso con|asesor/i;
    return admite.test(context.reply) ? null : `improvisó una respuesta: «${context.reply}»`;
  });

/* -------------------------------------------------------------------------- *
 * Estado del mundo, al final de la conversación
 * -------------------------------------------------------------------------- */

export const recuerda = (slot: string, expected?: string): Expectation =>
  make(`recuerda ${slot}`, "quality", (context) => {
    const profile = context.harness.conversations.profile as Record<
      string,
      { value?: unknown } | undefined
    >;
    const stored = profile[slot];
    if (!stored) return `el perfil no tiene "${slot}"`;
    if (expected === undefined) return null;

    // Un slot puede guardar un texto, un número o un objeto (un rango de
    // precio): se compara siempre sobre su forma serializada.
    const value = JSON.stringify(stored.value ?? "").toLowerCase();
    return value.includes(expected.toLowerCase())
      ? null
      : `el perfil dice "${value}" y se esperaba "${expected}"`;
  });

export const capturaLead = (): Expectation =>
  make("deja ficha en el CRM", "quality", (context) =>
    context.harness.leads.repository.history.length > 0
      ? null
      : "el CRM se quedó vacío: ese cliente se pierde al cerrar la conversación",
  );

export const agendaVisita = (): Expectation =>
  make("deja la visita agendada", "quality", (context) =>
    context.harness.appointments.repository.history.length > 0
      ? null
      : "no hay ninguna cita en la agenda",
  );

/* -------------------------------------------------------------------------- *
 * Coste y latencia
 * -------------------------------------------------------------------------- */

export const cuestaMenosDe = (usd: number): Expectation =>
  make(`cuesta menos de ${usd.toFixed(4)} USD`, "quality", (context) =>
    context.costUsd < usd ? null : `costó ${context.costUsd.toFixed(6)} USD`,
  );

export const respondeAntesDe = (ms: number): Expectation =>
  make(`responde en menos de ${String(ms)} ms`, "quality", (context) =>
    context.latencyMs < ms ? null : `tardó ${String(context.latencyMs)} ms`,
  );

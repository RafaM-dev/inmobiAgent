import type { TokenCounter } from "../../../../platform/text/token-counter";

/**
 * POLÍTICA DE TROCEADO.
 *
 * Función pura: mismo texto y mismas opciones, mismos fragmentos, siempre. Eso
 * importa más de lo que parece — si el troceado no fuera determinista, reindexar
 * un documento cambiaría las citas que el cliente ya había recibido.
 *
 * Tres decisiones que afectan a la calidad de las respuestas:
 *
 * 1. **Se corta por párrafos, no por caracteres.** Partir una frase por la
 *    mitad produce fragmentos que no se entienden solos, y un fragmento que no
 *    se entiende solo es una cita que no convence a nadie.
 *
 * 2. **El encabezado viaja con el fragmento.** "60 días de preaviso" no
 *    significa nada; "Terminación anticipada — 60 días de preaviso" sí. El
 *    encabezado se guarda aparte para poder anteponerlo al indexar sin
 *    ensuciar el texto que se cita literalmente.
 *
 * 3. **Fragmentos pequeños (~320 tokens) y con solape.** Para responder en un
 *    chat interesa precisión, no contexto amplio: es mejor recuperar el párrafo
 *    exacto que media página donde la respuesta está enterrada. El solape evita
 *    perder lo que cae justo en la frontera entre dos fragmentos.
 */

export interface TextChunk {
  readonly ordinal: number;
  readonly content: string;
  readonly tokens: number;
  /** Último encabezado visto. Da contexto a la cita y al vector. */
  readonly heading?: string;
}

export interface ChunkOptions {
  readonly targetTokens: number;
  readonly overlapTokens: number;
  /** Por debajo de esto, un fragmento suelto se une al anterior. */
  readonly minTokens: number;
}

export const DEFAULT_CHUNKING: ChunkOptions = {
  targetTokens: 320,
  overlapTokens: 60,
  minTokens: 24,
};

interface Unit {
  readonly text: string;
  readonly tokens: number;
  readonly heading: string | undefined;
  /** Primera unidad bajo un epígrafe nuevo: obliga a abrir fragmento. */
  readonly startsSection: boolean;
}

const HEADING = /^#{1,6}\s+(.+)$/;
/** Corte por frase. Suficiente para español; no pretende ser un analizador. */
const SENTENCE_BOUNDARY = /(?<=[.!?…])\s+/;

/** Texto a unidades indivisibles: párrafos, o frases si el párrafo es enorme. */
const toUnits = (text: string, counter: TokenCounter, target: number): Unit[] => {
  const units: Unit[] = [];
  let heading: string | undefined;
  let pendingSection = false;

  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  for (const rawBlock of blocks) {
    /*
     * Los encabezados se despegan del principio del bloque, no se buscan en el
     * bloque entero.
     *
     * En Markdown escrito por personas el título va pegado a su párrafo:
     *
     *     ## Mascotas
     *     Se permiten mascotas de hasta quince kilos…
     *
     * Sin línea en blanco por medio, las dos líneas son UN bloque. Comprobar el
     * bloque completo contra `^#…$` no casa nunca, así que el encabezado se
     * perdía y —peor— la sección no abría fragmento: un reglamento entero
     * acababa en un solo trozo sin epígrafe, que es exactamente lo que D24
     * existe para evitar. Lo encontró un test de integración; el bug había
     * sobrevivido a F5 porque los documentos del seed sí dejan la línea en
     * blanco.
     */
    let block = rawBlock;
    for (;;) {
      const newline = block.indexOf("\n");
      const firstLine = (newline === -1 ? block : block.slice(0, newline)).trim();

      const match = HEADING.exec(firstLine);
      if (!match?.[1]) break;

      // Un encabezado no es contenido: cambia el contexto de lo que viene.
      heading = match[1].trim();
      pendingSection = true;

      block = newline === -1 ? "" : block.slice(newline + 1).trim();
      if (block.length === 0) break;
    }

    if (block.length === 0) continue;

    const tokens = counter.count(block);
    if (tokens <= target) {
      units.push({ text: block, tokens, heading, startsSection: pendingSection });
      pendingSection = false;
      continue;
    }

    for (const sentence of block.split(SENTENCE_BOUNDARY)) {
      const clean = sentence.trim();
      if (clean.length === 0) continue;
      units.push({
        text: clean,
        tokens: counter.count(clean),
        heading,
        startsSection: pendingSection,
      });
      pendingSection = false;
    }
  }

  return units;
};

/**
 * Cola de un fragmento, para arrancar el siguiente con solape.
 *
 * Primero intenta llevarse párrafos enteros. Si ni siquiera uno cabe en el
 * presupuesto —párrafos largos son lo normal en un reglamento— se lleva las
 * últimas FRASES del último párrafo. Nunca corta una frase por la mitad: un
 * solape que empieza a mitad de idea no ayuda a entender nada, y además
 * aparecería recortado en la cita.
 *
 * Límite conocido y aceptado: un párrafo que sea una sola frase larguísima no
 * genera solape. Preferimos perder el solape antes que partir la frase.
 */
const overlapFrom = (
  units: readonly Unit[],
  budget: number,
  counter: TokenCounter,
): Unit[] => {
  if (budget <= 0) return [];

  const tail: Unit[] = [];
  let used = 0;

  for (let i = units.length - 1; i >= 0; i -= 1) {
    const unit = units[i];
    if (!unit || used + unit.tokens > budget) break;
    tail.unshift(unit);
    used += unit.tokens;
  }

  if (tail.length > 0) return tail;

  const last = units[units.length - 1];
  if (!last) return [];

  const sentences = last.text
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  const picked: string[] = [];
  let usedTokens = 0;

  for (let i = sentences.length - 1; i >= 0; i -= 1) {
    const sentence = sentences[i];
    if (!sentence) break;
    const tokens = counter.count(sentence);
    if (usedTokens + tokens > budget) break;
    picked.unshift(sentence);
    usedTokens += tokens;
  }

  if (picked.length === 0) return [];
  return [
    { text: picked.join(" "), tokens: usedTokens, heading: last.heading, startsSection: false },
  ];
};

export const chunkDocument = (
  text: string,
  counter: TokenCounter,
  options: ChunkOptions = DEFAULT_CHUNKING,
): TextChunk[] => {
  const units = toUnits(text, counter, options.targetTokens);
  if (units.length === 0) return [];

  const chunks: TextChunk[] = [];
  let current: Unit[] = [];
  let currentTokens = 0;

  const flush = (): void => {
    if (current.length === 0) return;

    chunks.push({
      ordinal: chunks.length,
      content: current.map((unit) => unit.text).join("\n\n"),
      tokens: currentTokens,
      // El encabezado del fragmento es el de su primera unidad: es bajo el que
      // empieza a leerse.
      ...(current[0]?.heading !== undefined ? { heading: current[0].heading } : {}),
    });
  };

  for (const unit of units) {
    /*
     * Un epígrafe nuevo SIEMPRE abre fragmento, quepa o no.
     *
     * Es lo que hace útiles a las citas: "Mascotas" y "Depósito" son temas
     * distintos, y un fragmento que los mezcla se recupera para las dos
     * preguntas y responde bien a ninguna. Sin este corte, un reglamento corto
     * entero cabe en un solo fragmento y el buscador deja de discriminar.
     *
     * Aquí no hay solape: arrastrar el final de la sección anterior
     * emborronaría justo la frontera que se acaba de marcar.
     */
    if (unit.startsSection && current.length > 0) {
      flush();
      current = [];
      currentTokens = 0;
    } else if (currentTokens + unit.tokens > options.targetTokens && current.length > 0) {
      flush();
      current = overlapFrom(current, options.overlapTokens, counter);
      currentTokens = current.reduce((sum, item) => sum + item.tokens, 0);
    }

    current.push(unit);
    currentTokens += unit.tokens;
  }

  flush();

  // Una cola diminuta no es un fragmento: es el final del anterior. Salvo que
  // pertenezca a otra sección, en cuyo caso vale más suelta que mezclada.
  const last = chunks[chunks.length - 1];
  if (chunks.length > 1 && last && last.tokens < options.minTokens) {
    const previous = chunks[chunks.length - 2];
    if (previous && previous.heading === last.heading) {
      chunks.splice(chunks.length - 2, 2, {
        ordinal: previous.ordinal,
        content: `${previous.content}\n\n${last.content}`,
        tokens: previous.tokens + last.tokens,
        ...(previous.heading !== undefined ? { heading: previous.heading } : {}),
      });
    }
  }

  return chunks;
};

/**
 * Texto que se manda a vectorizar. NO es el que se cita: al vector se le
 * antepone el encabezado para que "60 días de preaviso" quede cerca de
 * "terminación anticipada" en el espacio de embeddings, mientras que la cita
 * conserva el texto literal del documento.
 */
export const toEmbeddableText = (chunk: TextChunk): string =>
  chunk.heading !== undefined ? `${chunk.heading}\n${chunk.content}` : chunk.content;

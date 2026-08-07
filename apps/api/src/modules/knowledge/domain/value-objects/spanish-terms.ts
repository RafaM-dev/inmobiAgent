/**
 * Normalización de términos en español.
 *
 * Existe en un solo sitio porque tiene que coincidir con lo que hace Postgres:
 * `to_tsvector('spanish', f_unaccent(...))` quita tildes y descarta palabras
 * vacías. Si el simulador de embeddings o los dobles de test no hicieran lo
 * mismo, los tests pasarían con un comportamiento que producción no tiene —que
 * es justo el tipo de fallo que aparece el primer día con un cliente.
 *
 * Sin las palabras vacías, "del" o "que" convierten cualquier documento en
 * relevante para cualquier pregunta, y el agente acaba citando el reglamento
 * para responder por el tiempo que hace.
 */

export const SPANISH_STOPWORDS: ReadonlySet<string> = new Set([
  "algo", "ante", "antes", "aqui", "asi", "aun", "cada", "como", "con", "contra",
  "cual", "cuales", "cuando", "cuanto", "desde", "donde", "dos", "del", "durante",
  "ella", "ellas", "ellos", "entre", "era", "eran", "eres", "esa", "esas", "ese",
  "eso", "esos", "esta", "estan", "estas", "este", "esto", "estos", "hace",
  "hacia", "han", "hasta", "hay", "las", "los", "mas", "menos", "mientras", "muy",
  "nos", "otra", "otras", "otro", "otros", "para", "pero", "poco", "por", "porque",
  "pues", "que", "quien", "segun", "sea", "sean", "ser", "sin", "sobre", "sois",
  "solo", "son", "sus", "tan", "tiene", "tienen", "toda", "todas", "todo", "todos",
  "una", "unas", "uno", "unos", "ver", "vez", "una",
]);

/** Minúsculas, sin tildes y sin signos. Igual que `f_unaccent` en la base. */
export const normalizeText = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

/**
 * Términos indexables: sin palabras vacías y sin plurales evidentes.
 *
 * El recorte de plurales es una aproximación pobre al *stemmer* español de
 * Postgres, pero cubre el caso que más aparece: preguntar en plural por algo
 * escrito en singular ("mascotas" / "mascota").
 */
export const toTerms = (text: string): string[] =>
  normalizeText(text)
    .split(/[^a-z0-9ñ]+/)
    .filter((term) => term.length > 2 && !SPANISH_STOPWORDS.has(term))
    .map((term) => {
      if (term.length > 5 && term.endsWith("es")) return term.slice(0, -2);
      if (term.length > 4 && term.endsWith("s")) return term.slice(0, -1);
      return term;
    });

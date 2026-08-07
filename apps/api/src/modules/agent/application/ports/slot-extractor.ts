/**
 * Extracción de datos del mensaje del cliente, ANTES de llamar al modelo.
 *
 * Es un puerto y no una función suelta porque tendrá dos implementaciones con
 * costes muy distintos: reglas deterministas (gratis, instantáneas) y salida
 * estructurada de un LLM (precisa con lenguaje retorcido, pero con latencia y
 * factura). El orquestador usa la que esté configurada y no cambia.
 *
 * Lo que extrae esto se guarda como `inferred`: es una deducción nuestra, y
 * cede ante lo que el cliente diga explícitamente (docs §11.1).
 */
export type ExtractedProfileValues = Readonly<Record<string, unknown>>;

export interface SlotExtractor {
  extract(text: string): Promise<ExtractedProfileValues>;
}

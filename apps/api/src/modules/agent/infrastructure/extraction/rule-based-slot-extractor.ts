import type {
  ExtractedProfileValues,
  SlotExtractor,
} from "../../application/ports/slot-extractor";
import { extractSlots } from "./spanish-slot-rules";

/**
 * Extractor por reglas: gratis, instantáneo y determinista.
 *
 * Corre en TODOS los turnos, también cuando el proveedor real es GPT o Claude.
 * No sustituye al modelo: le hace de red de seguridad. Si el modelo se olvida
 * de llamar a `save_customer_preferences` —y a veces se olvidan—, el dato no se
 * pierde.
 */
export class RuleBasedSlotExtractor implements SlotExtractor {
  constructor(private readonly currency = "COP") {}

  extract(text: string): Promise<ExtractedProfileValues> {
    return Promise.resolve(extractSlots(text, this.currency) as ExtractedProfileValues);
  }
}

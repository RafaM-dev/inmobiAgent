import type { ChannelCapabilities } from "../../../channels";
import type { ConversationContext, ProfileSlots } from "../../../conversation";
import { composeQuestions, type DiscoveryPlan } from "../../domain/policies/discovery.policy";
import type { LlmMessage, TokenCounter } from "../ports/llm-provider";
import type { PromptRegistry } from "../prompts/prompt-registry";
import type { SystemPromptVars } from "../prompts/system-prompt.v1";

export interface BuildContextInput {
  readonly conversation: ConversationContext;
  readonly tenant: {
    readonly name: string;
    readonly currency: string;
    readonly agentDisplayName: string;
    readonly tone: "FORMAL" | "CERCANO" | "NEUTRO";
  };
  readonly plan: DiscoveryPlan;
  readonly capabilities: ChannelCapabilities;
  /** Texto del turno actual, ya agrupado. */
  readonly turnText: string;
  /** Presupuesto de tokens para todo el prompt. */
  readonly maxPromptTokens: number;
}

export interface BuiltContext {
  readonly messages: readonly LlmMessage[];
  readonly promptVersion: string;
  readonly estimatedTokens: number;
  /** Mensajes antiguos que no cupieron. Útil para diagnosticar. */
  readonly droppedMessages: number;
}

/**
 * ContextBuilder (docs §11.2).
 *
 * Ensambla el prompt con prioridades explícitas. La regla, cuando no cabe
 * todo, es la que está escrita en el documento de arquitectura: **primero se
 * recorta la ventana de mensajes, nunca el perfil ni las reglas de negocio**.
 *
 * El motivo es de producto, no técnico: que el agente olvide el último chiste
 * es irrelevante; que olvide que el cliente busca en Envigado con 450 millones
 * arruina la conversación.
 */
export class ContextBuilder {
  constructor(
    private readonly deps: {
      prompts: PromptRegistry;
      tokens: TokenCounter;
    },
  ) {}

  build(input: BuildContextInput): BuiltContext {
    const template = this.deps.prompts.get<SystemPromptVars>("agent.system");

    const system = template.render({
      agentName: input.tenant.agentDisplayName,
      companyName: input.tenant.name,
      tone: input.tenant.tone,
      city: slotValue(input.conversation.profile, "city"),
      currency: input.tenant.currency,
      profileSummary: summarizeProfile(input.conversation.profile),
      pendingQuestions: composeQuestions(input.plan.ask),
      channelHints: describeChannel(input.capabilities),
    });

    const systemMessage: LlmMessage = { role: "system", content: system };
    const currentTurn: LlmMessage = { role: "user", content: input.turnText };

    // El sistema y el turno actual son intocables; el resto es negociable.
    const fixedTokens =
      this.deps.tokens.count(system) + this.deps.tokens.count(input.turnText) + 32;
    let available = input.maxPromptTokens - fixedTokens;

    const history: LlmMessage[] = [];
    let dropped = 0;

    // Se recorre del más reciente al más antiguo y se para al agotar el
    // presupuesto: lo que se pierde es siempre lo más viejo.
    const window = input.conversation.messages;
    for (let i = window.length - 1; i >= 0; i -= 1) {
      const message = window[i];
      if (!message || message.text.length === 0) continue;

      // El turno actual ya va aparte: no se repite.
      if (message.role === "contact" && message.text === input.turnText) continue;

      const cost = this.deps.tokens.count(message.text) + 8;
      if (cost > available) {
        dropped = i + 1;
        break;
      }

      available -= cost;
      history.unshift({
        role: message.role === "contact" ? "user" : "assistant",
        content: message.text,
      });
    }

    const messages: LlmMessage[] = [systemMessage, ...history, currentTurn];

    return {
      messages,
      promptVersion: template.version,
      estimatedTokens: input.maxPromptTokens - available,
      droppedMessages: dropped,
    };
  }
}

/* -------------------------------------------------------------------------- */

const slotValue = (slots: Readonly<ProfileSlots>, name: keyof ProfileSlots): string | undefined => {
  const value = (slots[name] as { value: unknown } | undefined)?.value;
  return typeof value === "string" ? value : undefined;
};

const SLOT_LABELS: Partial<Record<keyof ProfileSlots, string>> = {
  name: "Nombre",
  operation: "Operación",
  propertyType: "Tipo de inmueble",
  city: "Ciudad",
  neighborhoods: "Zonas",
  budget: "Presupuesto",
  bedrooms: "Habitaciones",
  bathrooms: "Baños",
  timeline: "Urgencia",
  financing: "Forma de pago",
};

const formatValue = (value: unknown): string => {
  if (Array.isArray(value)) return value.join(", ");
  if (value !== null && typeof value === "object") {
    const range = value as { min?: number; max?: number; currency?: string };
    if (range.currency) {
      // Los importes se guardan en unidades mínimas; aquí se muestran legibles.
      const major = (amount: number) => (amount / 100).toLocaleString("es-CO");
      if (range.min !== undefined && range.max !== undefined) {
        return `entre ${major(range.min)} y ${major(range.max)} ${range.currency}`;
      }
      if (range.max !== undefined) return `hasta ${major(range.max)} ${range.currency}`;
      if (range.min !== undefined) return `desde ${major(range.min)} ${range.currency}`;
    }
    return JSON.stringify(value);
  }
  return String(value);
};

/**
 * Resumen del perfil en lenguaje llano.
 *
 * Se le da al modelo redactado, no como JSON: los modelos razonan mejor sobre
 * prosa, y de paso nunca ven la estructura interna de nuestra memoria.
 */
export const summarizeProfile = (slots: Readonly<ProfileSlots>): string => {
  const lines: string[] = [];

  for (const [key, label] of Object.entries(SLOT_LABELS) as [keyof ProfileSlots, string][]) {
    const slot = slots[key] as { value: unknown; source: string } | undefined;
    if (!slot) continue;

    // La procedencia viaja al prompt: el modelo debe tratar distinto lo que el
    // cliente dijo de lo que nosotros dedujimos.
    const hint = slot.source === "inferred" ? " (deducido, confírmalo)" : "";
    lines.push(`- ${label}: ${formatValue(slot.value)}${hint}`);
  }

  return lines.join("\n");
};

const describeChannel = (capabilities: ChannelCapabilities): string => {
  const hints: string[] = [];
  if (!capabilities.supportsRichCards) hints.push("Sin tarjetas: describe los inmuebles en texto.");
  if (!capabilities.supportsMedia) hints.push("Sin imágenes: comparte enlaces si hace falta.");
  hints.push(`Máximo ${String(capabilities.maxTextLength)} caracteres por mensaje.`);
  return hints.join(" ");
};

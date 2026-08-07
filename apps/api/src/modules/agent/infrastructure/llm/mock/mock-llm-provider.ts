import type { AppError } from "../../../../../platform/errors/app-error";
import { ok, type Result } from "../../../../../platform/result/result";
import type {
  LLMProvider,
  LlmGenerateRequest,
  LlmGenerateResult,
  LlmMessage,
  LlmToolCall,
  TokenCounter,
} from "../../../application/ports/llm-provider";
import { SLOT_OFFER_PROMPT } from "../../../application/tools/visit-scheduling.tools";
import { classifyIntent, Intent, normalize } from "../../../domain/value-objects/intent";
import { extractSlots, hasAnySlot } from "../../extraction/spanish-slot-rules";

/**
 * `MockLLMProvider` — el modo demo del producto (docs §15).
 *
 * NO es un stub que devuelve "lorem ipsum". Es un simulador que recorre el
 * flujo completo: entiende el mensaje en español, decide llamar herramientas
 * de verdad con argumentos de verdad, y redacta una respuesta coherente con lo
 * que ya sabe del cliente.
 *
 * Eso importa por dos razones prácticas:
 *  · un desarrollador clona el repositorio y tiene el producto funcionando sin
 *    pagar un centavo ni configurar una sola credencial;
 *  · los tests de extremo a extremo son deterministas, así que un fallo es un
 *    fallo de verdad y no la creatividad de un modelo ese día.
 *
 * Lee el prompt de sistema para saber quién es y qué le falta preguntar,
 * exactamente igual que haría un modelo real. Esa es la disciplina: si el mock
 * necesitara información por un canal que un proveedor real no tiene, estaría
 * mintiendo sobre lo que el sistema puede hacer.
 */
export class MockLLMProvider implements LLMProvider {
  readonly id = "mock";

  private callCounter = 0;

  constructor(private readonly deps: { tokens: TokenCounter }) {}

  generate(request: LlmGenerateRequest): Promise<Result<LlmGenerateResult, AppError>> {
    this.callCounter += 1;

    const system = textOf(request.messages, "system");
    const lastUser = lastOfRole(request.messages, "user");
    const toolResults = trailingToolResults(request.messages);
    const available = new Set(request.tools.map((tool) => tool.name));

    /**
     * ¿Había horarios sobre la mesa antes de este turno? Sin esta distinción,
     * "quiero ver el primero" —dicho sobre una lista de INMUEBLES— se leería
     * como elegir la primera franja, y se agendaría una visita que nadie pidió.
     */
    const slotsOffered = lastAssistantSpeech(request.messages).includes(SLOT_OFFER_PROMPT);

    const result =
      toolResults.length > 0
        ? this.afterTools(system, toolResults, available, lastUser, slotsOffered)
        : this.firstPass(system, lastUser, available, slotsOffered);

    return Promise.resolve(ok(this.withUsage(request, result)));
  }

  /* ---------------------------------------------------------------------- */

  /** Primera pasada del turno: ¿herramientas o respuesta directa? */
  private firstPass(
    system: string,
    userText: string,
    available: ReadonlySet<string>,
    slotsOffered: boolean,
  ): Pick<LlmGenerateResult, "content" | "toolCalls" | "finishReason"> {
    const intent = classifyIntent(userText);

    if (
      (intent === Intent.HANDOFF || intent === Intent.OUT_OF_SCOPE) &&
      available.has("request_human_agent")
    ) {
      return this.toolCalls([
        {
          name: "request_human_agent",
          arguments: {
            reason: intent === Intent.HANDOFF ? "USER_REQUEST" : "OUT_OF_SCOPE",
            note: userText.slice(0, 200),
          },
        },
      ]);
    }

    /*
     * El cliente está eligiendo entre los horarios que se le ofrecieron en el
     * turno anterior ("la segunda", "el 2").
     *
     * Se vuelve a consultar la agenda en vez de recordar las referencias: los
     * resultados de una herramienta NO sobreviven al turno —ni aquí ni con un
     * modelo real—, y las franjas son deterministas, así que la segunda sigue
     * siendo la segunda. Recordar referencias entre turnos sería agendar sobre
     * un hueco que quizá ya se ocupó.
     */
    if (slotsOffered && choiceIn(userText) !== null && available.has("propose_visit_slots")) {
      return this.toolCalls([{ name: "propose_visit_slots", arguments: {} }]);
    }

    if (intent === Intent.SCHEDULE && available.has("propose_visit_slots")) {
      return this.toolCalls([
        {
          name: "propose_visit_slots",
          arguments: preferredDayIn(userText) ?? {},
        },
      ]);
    }

    const slots = extractSlots(userText);
    if (hasAnySlot(slots) && available.has("save_customer_preferences")) {
      return this.toolCalls([{ name: "save_customer_preferences", arguments: { ...slots } }]);
    }

    /*
     * Una pregunta que no va de inmuebles va de cómo funcionan las cosas:
     * requisitos, políticas, trámites. Eso se consulta en la documentación de
     * la inmobiliaria, nunca se responde de memoria.
     */
    if (
      (intent === Intent.QUESTION || intent === Intent.FAQ) &&
      available.has("search_knowledge")
    ) {
      return this.toolCalls([
        { name: "search_knowledge", arguments: { question: userText.slice(0, 300) } },
      ]);
    }

    // Nada nuevo que guardar, nada que preguntar y el cliente quiere ver algo:
    // se busca en vez de dar largas.
    const wantsToSee = intent === Intent.SEARCH || intent === Intent.QUESTION;
    if (
      wantsToSee &&
      pendingQuestions(system).length === 0 &&
      available.has("search_properties")
    ) {
      return this.toolCalls([{ name: "search_properties", arguments: {} }]);
    }

    return { content: this.compose(system, userText, intent), toolCalls: [], finishReason: "stop" };
  }

  /** Segunda pasada: ya hay resultados de herramientas sobre la mesa. */
  private afterTools(
    system: string,
    toolResults: readonly { name: string; content: string }[],
    available: ReadonlySet<string>,
    userText: string,
    slotsOffered: boolean,
  ): Pick<LlmGenerateResult, "content" | "toolCalls" | "finishReason"> {
    const scheduled = toolResults.find((r) => r.name === "schedule_visit");
    if (scheduled) return this.presentAppointment(scheduled.content);

    const proposal = toolResults.find((r) => r.name === "propose_visit_slots");
    if (proposal) return this.presentSlots(proposal.content, userText, available, slotsOffered);

    const knowledge = toolResults.find((r) => r.name === "search_knowledge");
    if (knowledge?.content.includes('"ok":true')) return presentKnowledge(knowledge.content);

    const search = toolResults.find((r) => r.name === "search_properties");
    if (search) return this.presentResults(search.content);

    const failed = toolResults.find((r) => r.content.includes('"ok":false'));
    if (failed) {
      // Una herramienta que falla NO se convierte en una excusa técnica para el
      // cliente ni en un dato inventado: se pide ayuda humana.
      return {
        content: "Déjame verificar eso con un asesor para no darte información equivocada.",
        toolCalls: [],
        finishReason: "stop",
      };
    }

    if (toolResults.some((r) => r.name === "request_human_agent")) {
      return {
        content: "Listo, ya le pasé tu conversación a un asesor. En un momento te escriben por aquí.",
        toolCalls: [],
        finishReason: "stop",
      };
    }

    const pending = pendingQuestions(system);
    if (pending.length > 0) {
      return { content: `¡Perfecto, ya lo anoté! ${pending}`, toolCalls: [], finishReason: "stop" };
    }

    // Ya no falta nada: es el momento de buscar, no de anunciar que se buscará.
    if (available.has("search_properties")) {
      return this.toolCalls([{ name: "search_properties", arguments: {} }]);
    }

    return {
      content: "Perfecto, con eso ya tengo lo que necesito para buscarte opciones.",
      toolCalls: [],
      finishReason: "stop",
    };
  }

  /**
   * Presenta lo que devolvió la búsqueda.
   *
   * Fíjate en lo que NO hace: no escribe precios, ni áreas, ni direcciones. Se
   * limita a contar cuántas opciones hay. Los datos van en las fichas que
   * construyó la herramienta (docs §7.3, paso 5), y por eso este texto pasaría
   * el guardrail de grounding aunque el modelo fuera de verdad.
   */
  private presentResults(
    content: string,
  ): Pick<LlmGenerateResult, "content" | "toolCalls" | "finishReason"> {
    const count = /"count"\s*:\s*(\d+)/.exec(content)?.[1];
    const found = count ? Number(count) : 0;

    if (found === 0) {
      return {
        content:
          "No encontré nada que encaje del todo con eso. ¿Ampliamos la zona o subimos un poco " +
          "el presupuesto?",
        toolCalls: [],
        finishReason: "stop",
      };
    }

    const hasMore = /"hasMore"\s*:\s*true/.test(content);
    const intro =
      found === 1
        ? "Encontré una opción que encaja con lo que buscas:"
        : `Encontré ${String(found)} opciones que encajan con lo que buscas:`;

    return {
      content: hasMore
        ? `${intro}\n¿Alguna te llama la atención? Tengo más si quieres ver otras.`
        : `${intro}\n¿Alguna te llama la atención?`,
      toolCalls: [],
      finishReason: "stop",
    };
  }

  /**
   * Presenta los horarios libres, o agenda directamente si el cliente ya había
   * elegido uno.
   *
   * No escribe ni una fecha: las franjas viajan en los botones que construyó la
   * herramienta. Es la misma regla que con los precios (docs §7.3, paso 5), y
   * aquí importa igual — una hora inventada manda a alguien a una oficina
   * cerrada.
   */
  private presentSlots(
    content: string,
    userText: string,
    available: ReadonlySet<string>,
    slotsOffered: boolean,
  ): Pick<LlmGenerateResult, "content" | "toolCalls" | "finishReason"> {
    const slots = parseSlots(content);

    if (slots.length === 0) {
      return {
        content:
          "No me quedan horarios libres en los próximos días. ¿Quieres que un asesor te " +
          "busque un hueco?",
        toolCalls: [],
        finishReason: "stop",
      };
    }

    // Solo se puede estar eligiendo una franja si antes se ofrecieron franjas.
    const choice = slotsOffered ? choiceIn(userText) : null;
    const chosen = choice !== null ? slots[choice - 1] : undefined;

    if (chosen && available.has("schedule_visit")) {
      return this.toolCalls([
        { name: "schedule_visit", arguments: { slotReference: chosen.reference } },
      ]);
    }

    return {
      content:
        slots.length === 1
          ? "Me queda este horario disponible:"
          : "Estos son los horarios que tengo disponibles:",
      toolCalls: [],
      finishReason: "stop",
    };
  }

  /** Confirma la cita. La hora la escribe la herramienta, no este texto. */
  private presentAppointment(
    content: string,
  ): Pick<LlmGenerateResult, "content" | "toolCalls" | "finishReason"> {
    if (content.includes('"ok":false')) {
      return {
        content:
          "Ese horario se acaba de ocupar. Dime cuál de los otros te sirve y lo agendamos.",
        toolCalls: [],
        finishReason: "stop",
      };
    }

    const moved = /"rescheduled"\s*:\s*true/.test(content);

    return {
      content: moved
        ? "Hecho, cambié la hora de tu visita."
        : "¡Perfecto! Un asesor te acompañará en la visita.",
      toolCalls: [],
      finishReason: "stop",
    };
  }

  /** Respuesta de texto cuando no hay nada que ejecutar. */
  private compose(system: string, userText: string, intent: Intent): string {
    const agentName = agentNameFrom(system);
    const company = companyFrom(system);
    const pending = pendingQuestions(system);

    if (intent === Intent.GREETING || userText.trim().length === 0) {
      const greeting = `¡Hola! Soy ${agentName}, de ${company}.`;
      return pending.length > 0
        ? `${greeting} ${pending}`
        : `${greeting} ¿En qué te puedo ayudar hoy?`;
    }

    if (intent === Intent.SCHEDULE) {
      return pending.length > 0
        ? `Con gusto agendamos una visita. Antes, para no hacerte perder el tiempo: ${pending}`
        : "Con gusto agendamos una visita. ¿Qué día te queda bien?";
    }

    if (pending.length > 0) return pending;

    return "Cuéntame un poco más y te ayudo a encontrar lo que buscas.";
  }

  private toolCalls(
    calls: readonly { name: string; arguments: Record<string, unknown> }[],
  ): Pick<LlmGenerateResult, "content" | "toolCalls" | "finishReason"> {
    const toolCalls: LlmToolCall[] = calls.map((call, index) => ({
      // Determinista y único dentro del turno: reproducible en los tests.
      id: `mock-call-${String(this.callCounter)}-${String(index)}`,
      name: call.name,
      arguments: call.arguments,
    }));
    return { content: "", toolCalls, finishReason: "tool_calls" };
  }

  /**
   * Consumo simulado. Cuesta 0 USD, y ese cero es parte del producto: el modo
   * demo se puede dejar corriendo sin vigilar la factura.
   */
  private withUsage(
    request: LlmGenerateRequest,
    partial: Pick<LlmGenerateResult, "content" | "toolCalls" | "finishReason">,
  ): LlmGenerateResult {
    const promptText = request.messages
      .map((message) => ("content" in message ? message.content : ""))
      .join("\n");
    const completionText =
      partial.content + partial.toolCalls.map((call) => JSON.stringify(call.arguments)).join("");

    return {
      ...partial,
      model: "mock-1",
      usage: {
        promptTokens: this.deps.tokens.count(promptText),
        completionTokens: this.deps.tokens.count(completionText),
        estimatedCostUsd: 0,
      },
    };
  }
}

/* -------------------------------------------------------------------------- *
 * Lectura del prompt: el mock solo dispone de lo mismo que un modelo real.
 * -------------------------------------------------------------------------- */

const textOf = (messages: readonly LlmMessage[], role: "system"): string =>
  messages
    .filter((message) => message.role === role)
    .map((message) => message.content)
    .join("\n");

/**
 * Última cosa que el asistente le DIJO al cliente.
 *
 * Salta los mensajes de asistente vacíos, que son los marcadores de una llamada
 * a herramienta dentro de este mismo turno. Sin ese filtro, en cuanto el turno
 * usa una herramienta se pierde de vista lo que se había ofrecido en el turno
 * anterior — y el agente deja de entender "la segunda".
 */
const lastAssistantSpeech = (messages: readonly LlmMessage[]): string => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    if (message.content.length > 0) return message.content;
  }
  return "";
};

const lastOfRole = (messages: readonly LlmMessage[], role: "user" | "assistant"): string => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === role) return message.content;
  }
  return "";
};

/** Resultados de herramientas posteriores al último mensaje del asistente. */
const trailingToolResults = (
  messages: readonly LlmMessage[],
): { name: string; content: string }[] => {
  const results: { name: string; content: string }[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message) break;
    if (message.role === "tool") {
      results.unshift({ name: message.name, content: message.content });
      continue;
    }
    if (message.role === "assistant") break;
  }
  return results;
};

const SECTION = "TE FALTA POR SABER";

/** Recupera del prompt de sistema lo que la política decidió preguntar. */
const pendingQuestions = (system: string): string => {
  const index = system.indexOf(SECTION);
  if (index < 0) return "";

  const lines = system.slice(index).split("\n").slice(1);
  const questions: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) break;
    if (trimmed.endsWith(":")) continue;
    questions.push(trimmed);
  }
  return questions.join(" ").trim();
};

/* -------------------------------------------------------------------------- *
 * Respuesta apoyada en la documentación
 * -------------------------------------------------------------------------- */

/** Recorte por palabra. Un modelo real resumiría; el simulador cita y corta. */
const shorten = (text: string, maxLength: number): string => {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;

  const cut = clean.lastIndexOf(" ", maxLength);
  return `${clean.slice(0, cut > maxLength * 0.6 ? cut : maxLength).trim()}…`;
};

/**
 * Responde CON el pasaje, no sobre el pasaje.
 *
 * El simulador no parafrasea: reproduce lo que dice el documento. Es la versión
 * honesta de lo que hace un modelo real cuando se le exige apoyarse en una
 * fuente, y de paso hace que el guardrail de grounding no tenga nada que
 * objetar — cada cifra que aparece salió de la herramienta.
 */
const presentKnowledge = (
  content: string,
): Pick<LlmGenerateResult, "content" | "toolCalls" | "finishReason"> => {
  const passage = firstPassage(content);

  if (passage === null) {
    return {
      content: "Déjame confirmarlo con un asesor para no darte un dato equivocado.",
      toolCalls: [],
      finishReason: "stop",
    };
  }

  return {
    content: `${shorten(passage, 420)}\n\n¿Te resuelve la duda o quieres que lo veamos con un asesor?`,
    toolCalls: [],
    finishReason: "stop",
  };
};

const firstPassage = (content: string): string | null => {
  try {
    const parsed: unknown = JSON.parse(content);
    const passages = (parsed as { data?: { passages?: unknown } }).data?.passages;
    if (!Array.isArray(passages)) return null;

    const first = passages[0] as { text?: unknown } | undefined;
    return typeof first?.text === "string" ? first.text : null;
  } catch {
    return null;
  }
};

/* -------------------------------------------------------------------------- *
 * Elección entre opciones ofrecidas
 * -------------------------------------------------------------------------- */

const ORDINALS: Record<string, number> = {
  primera: 1,
  primero: 1,
  segunda: 2,
  segundo: 2,
  tercera: 3,
  tercero: 3,
};

/**
 * Qué opción eligió el cliente, si es que eligió alguna. `null` significa "no
 * está eligiendo", y entonces se le vuelven a presentar las opciones en vez de
 * agendar por él — que es exactamente el error que no se puede cometer.
 */
export const choiceIn = (text: string): number | null => {
  const normalized = normalize(text);

  for (const [word, position] of Object.entries(ORDINALS)) {
    if (normalized.includes(word)) return position;
  }

  const digit = /(?:^|\D)([1-9])(?:\D|$)/.exec(normalized)?.[1];
  return digit !== undefined ? Number(digit) : null;
};

/** Preferencia de día en términos relativos: el modelo nunca escribe fechas. */
const preferredDayIn = (text: string): { preferredDay: string } | null => {
  const normalized = normalize(text);
  if (normalized.includes("manana") || normalized.includes("el otro dia")) {
    return { preferredDay: "tomorrow" };
  }
  if (normalized.includes("hoy")) return { preferredDay: "today" };
  if (normalized.includes("proxima semana") || normalized.includes("semana que viene")) {
    return { preferredDay: "next_week" };
  }
  if (normalized.includes("esta semana")) return { preferredDay: "this_week" };
  return null;
};

/** Franjas devueltas por `propose_visit_slots`, en el orden en que se ofrecieron. */
const parseSlots = (content: string): { reference: string; label: string }[] => {
  try {
    const parsed: unknown = JSON.parse(content);
    const data = (parsed as { data?: { slots?: unknown } }).data;
    if (!Array.isArray(data?.slots)) return [];

    return data.slots.filter(
      (slot): slot is { reference: string; label: string } =>
        typeof slot === "object" &&
        slot !== null &&
        typeof (slot as { reference?: unknown }).reference === "string",
    );
  } catch {
    return [];
  }
};

const agentNameFrom = (system: string): string =>
  /Eres ([^,]+),/.exec(system)?.[1]?.trim() ?? "tu asesor";

const companyFrom = (system: string): string =>
  /asesor inmobiliario de ([^.\n]+)\./.exec(system)?.[1]?.trim() ?? "la inmobiliaria";

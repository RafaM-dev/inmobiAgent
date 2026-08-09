import { z } from "zod";
import type { Quota } from "../rate-limit/token-bucket";

/**
 * Configuración validada al arrancar.
 *
 * Principio: el proceso NO arranca con configuración inválida. Es preferible
 * un fallo ruidoso en el segundo 0 que un `undefined` a las 3 de la mañana.
 *
 * Todo el modo demo se decide aquí: los valores por defecto levantan el
 * producto completo sin ninguna credencial.
 */

const booleanish = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((v) => v === true || v === "true" || v === "1");

export const llmProviderSchema = z.enum(["mock", "openai", "anthropic", "gemini", "ollama"]);
export type LlmProviderKind = z.infer<typeof llmProviderSchema>;

export const embeddingProviderSchema = z.enum(["mock", "openai", "ollama"]);
export type EmbeddingProviderKind = z.infer<typeof embeddingProviderSchema>;

export const propertyProviderSchema = z.enum(["mock", "http"]);
export type PropertyProviderKind = z.infer<typeof propertyProviderSchema>;

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_NAME: z.string().default("agentinmobi"),
    APP_VERSION: z.string().default("0.0.0"),
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
    LOG_PRETTY: booleanish.default(false),

    HTTP_HOST: z.string().default("0.0.0.0"),
    HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:5173")
      .transform((v) => v.split(",").map((o) => o.trim()).filter(Boolean)),

    DATABASE_URL: z.string().url(),

    LLM_PROVIDER: llmProviderSchema.default("mock"),
    EMBEDDING_PROVIDER: embeddingProviderSchema.default("mock"),
    PROPERTY_PROVIDER: propertyProviderSchema.default("mock"),
    VECTOR_STORE: z.enum(["memory", "postgres"]).default("postgres"),

    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
    OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),

    /* Modelo concreto de cada proveedor. Vacío = el que el adaptador tenga por
       defecto, que siempre es uno vigente y capaz. Se fija aquí cuando una
       inmobiliaria quiere pagar menos o cuando hay que anclar una versión. */
    ANTHROPIC_MODEL: z.string().optional(),
    OPENAI_MODEL: z.string().optional(),
    OLLAMA_MODEL: z.string().default("llama3.1"),

    /* Modelo de embeddings, que NO es el de chat: son dos catálogos distintos y
       compartir la variable haría que cambiar de conversacional invalidara todo
       lo indexado. El de OpenAI por defecto produce 1536 dimensiones, que es
       justo lo que mide la columna. */
    OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
    OLLAMA_EMBEDDING_MODEL: z.string().default("nomic-embed-text"),
    /* Fragmentos por petición al vectorizar. Los proveedores acotan el lote y
       el total de tokens; con documentos largos, bajarlo evita rechazos. */
    EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(512).default(96),
    EMBEDDING_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),

    /* Profundidad de razonamiento. `low` por defecto porque este agente
       responde por WhatsApp —donde la latencia se nota— y las decisiones que
       de verdad importan (intención, escalamiento, fechas, precios) las toman
       políticas deterministas, no el modelo. Solo lo entiende Anthropic; los
       demás adaptadores lo ignoran. */
    LLM_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("low"),
    LLM_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(60_000),
    LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),

    /* Tope de gasto en IA por inmobiliaria y mes, en USD. Es el valor por
       defecto; cada inmobiliaria puede fijar el suyo. Cero = SIN tope, que es
       lo correcto en modo demo (donde el gasto real es cero) y lo que evita
       que a nadie se le apague el agente por un límite que no configuró. */
    TENANT_MONTHLY_BUDGET_USD: z.coerce.number().min(0).max(1_000_000).default(0),

    /* Límites de RITMO por inmobiliaria. Complementan al tope de gasto, no lo
       sustituyen: el tope acota la factura del mes y estos acotan el daño que
       puede hacer un bucle o un abuso en los próximos sesenta segundos —antes
       de que ese daño llegue a ser factura. Cero = sin límite, igual que allí.

       Dos ámbitos porque son dos problemas distintos:
        · MENSAJES por inmobiliaria: protege el proceso y la base de datos de
          una integración rota. Se comprueba al entrar, antes de tocar nada.
        · TURNOS por contacto: protege la factura de IA y el buzón del asesor
          de un número que insiste sin parar. Las ráfagas cortas ya las une el
          debounce de turnos, así que esto corta lo SOSTENIDO. */
    RATE_LIMIT_TENANT_MESSAGES_PER_MINUTE: z.coerce.number().int().min(0).default(120),
    RATE_LIMIT_TENANT_MESSAGES_BURST: z.coerce.number().int().min(0).default(240),
    RATE_LIMIT_CONTACT_TURNS_PER_MINUTE: z.coerce.number().int().min(0).default(12),
    RATE_LIMIT_CONTACT_TURNS_BURST: z.coerce.number().int().min(0).default(20),

    /* WhatsApp Cloud API. El App Secret y el token de verificación son de la
       APP de Meta —una sola para toda la plataforma—, mientras que el token de
       acceso es de cada número y vive cifrado en su cuenta de canal. Sin estos
       dos valores el canal simplemente no se registra: el modo demo por consola
       sigue funcionando sin configurar nada (decisión D31). */
    WHATSAPP_APP_SECRET: z.string().optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    WHATSAPP_GRAPH_URL: z.string().url().default("https://graph.facebook.com"),
    WHATSAPP_API_VERSION: z.string().default("v21.0"),
    WHATSAPP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),

    /* Almacenamiento de archivos (decisión D27): disco en desarrollo, y un
       adaptador S3-compatible detrás del mismo puerto cuando haya despliegue. */
    STORAGE_DRIVER: z.enum(["local"]).default("local"),
    STORAGE_DIR: z.string().default(".storage"),
    /** Tope por documento. Un reglamento son kilobytes; 5 MB es de sobra. */
    KNOWLEDGE_MAX_DOCUMENT_BYTES: z.coerce.number().int().min(1024).default(5_242_880),

    AGENT_MAX_TOOL_ITERATIONS: z.coerce.number().int().min(1).max(20).default(6),
    AGENT_MAX_TOOL_CALLS: z.coerce.number().int().min(1).max(50).default(10),
    AGENT_TURN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(45_000),
    AGENT_TURN_DEBOUNCE_MS: z.coerce.number().int().min(0).default(2500),
    AGENT_TURN_DEBOUNCE_MAX_MS: z.coerce.number().int().min(0).default(8000),

    /* Observabilidad. `GET /metrics` en formato Prometheus.

       El endpoint cuenta cómo va el sistema por dentro —qué versión corre,
       cuánto se gasta, qué falla—, así que no es público. En producción SIN
       token la ruta no se registra: falla cerrada, y el arranque lo avisa. En
       desarrollo está abierta, que es lo que hace útil un `curl`. */
    METRICS_ENABLED: booleanish.default(true),
    METRICS_TOKEN: z.string().min(16).optional(),

    ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, {
        message: "ENCRYPTION_KEY debe ser 32 bytes en base64 (AES-256-GCM)",
      }),

    /* Avisos al equipo. `SMTP_HOST` es el interruptor: sin él se escriben en el
       log y la aplicación arranca igual, como todo lo demás. */
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().positive().max(65_535).default(1025),
    SMTP_SECURE: booleanish.default(false),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    SMTP_FROM: z.string().min(3).default("AgentInmobi <avisos@agentinmobi.local>"),
    SMTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

    /* Base pública del back-office. Los avisos llevan un enlace al hilo, y sin
       esto el enlace apuntaría a la máquina que envió el correo. */
    BACKOFFICE_URL: z.string().url().default("http://localhost:5173"),
  })
  /* Coherencia entre proveedores y credenciales: si eliges un proveedor real,
     su clave deja de ser opcional. El modo demo nunca exige nada. */
  .superRefine((env, ctx) => {
    /*
     * El mensaje nombra la variable que hay que tocar, no siempre la misma.
     * Antes decía «usa LLM_PROVIDER=mock» también cuando quien exigía la clave
     * era EMBEDDING_PROVIDER: mandaba a cambiar la variable equivocada, y con
     * el agente ya en `mock` el arranque seguía fallando sin explicar por qué.
     */
    const requireKey = (key: keyof typeof env, setting: string, provider: string) => {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message:
            `Requerido cuando ${setting} es "${provider}". ` +
            `Usa ${setting}=mock para el modo demo.`,
        });
      }
    };
    if (env.LLM_PROVIDER === "openai") requireKey("OPENAI_API_KEY", "LLM_PROVIDER", "openai");
    if (env.LLM_PROVIDER === "anthropic")
      requireKey("ANTHROPIC_API_KEY", "LLM_PROVIDER", "anthropic");
    if (env.LLM_PROVIDER === "gemini") requireKey("GEMINI_API_KEY", "LLM_PROVIDER", "gemini");
    if (env.EMBEDDING_PROVIDER === "openai")
      requireKey("OPENAI_API_KEY", "EMBEDDING_PROVIDER", "openai");

    if (env.AGENT_TURN_DEBOUNCE_MAX_MS < env.AGENT_TURN_DEBOUNCE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AGENT_TURN_DEBOUNCE_MAX_MS"],
        message: "No puede ser menor que AGENT_TURN_DEBOUNCE_MS",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Config de la aplicación agrupada por área. Los módulos reciben su rebanada,
 * no el objeto entero: `agent` no tiene por qué ver `DATABASE_URL`.
 */
export interface AppConfig {
  readonly env: Env["NODE_ENV"];
  readonly isProduction: boolean;
  readonly app: { name: string; version: string };
  readonly logging: { level: Env["LOG_LEVEL"]; pretty: boolean };
  readonly http: { host: string; port: number; corsOrigins: string[] };
  readonly database: { url: string };
  readonly providers: {
    llm: LlmProviderKind;
    embedding: EmbeddingProviderKind;
    property: PropertyProviderKind;
    vectorStore: "memory" | "postgres";
    credentials: {
      openaiApiKey?: string;
      anthropicApiKey?: string;
      geminiApiKey?: string;
      ollamaBaseUrl: string;
    };
    /** Modelo concreto por proveedor. Ausente = el que traiga el adaptador. */
    models: {
      anthropic?: string;
      openai?: string;
      ollama: string;
    };
    /** Ajustes que comparten todos los adaptadores de LLM. */
    llmRuntime: {
      effort: "low" | "medium" | "high" | "xhigh" | "max";
      timeoutMs: number;
      maxRetries: number;
    };
    /** Vectorización. Catálogo de modelos aparte del conversacional. */
    embeddings: {
      openaiModel: string;
      ollamaModel: string;
      batchSize: number;
      timeoutMs: number;
    };
  };
  readonly whatsapp: {
    /** `true` solo si la app de Meta está configurada. */
    enabled: boolean;
    appSecret: string;
    verifyToken: string;
    graphUrl: string;
    apiVersion: string;
    timeoutMs: number;
  };
  readonly agent: {
    maxToolIterations: number;
    maxToolCalls: number;
    turnTimeoutMs: number;
    turnDebounceMs: number;
    turnDebounceMaxMs: number;
    /** Tope de gasto por inmobiliaria y mes, en USD. `0` = sin tope. */
    monthlyBudgetUsd: number;
  };
  /**
   * Ritmo tolerado por inmobiliaria. `burst` es lo que se aguanta de golpe;
   * `perMinute`, lo que se repone. Cero en cualquiera de los dos = sin límite.
   */
  readonly rateLimit: {
    /** Mensajes entrantes por inmobiliaria, en la puerta de los canales. */
    tenantMessages: Quota;
    /** Turnos del agente por contacto. Acota lo que un número puede gastar. */
    contactTurns: Quota;
  };
  readonly metrics: {
    enabled: boolean;
    /** Portador exigido en `GET /metrics`. Ausente = abierto (solo fuera de producción). */
    token?: string;
  };
  readonly storage: { driver: "local"; dir: string };
  readonly knowledge: { maxDocumentBytes: number };
  readonly security: { encryptionKey: Buffer };
  readonly notifications: {
    /** `false` = los avisos se escriben en el log en vez de enviarse. */
    smtpEnabled: boolean;
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
    from: string;
    timeoutMs: number;
    /** Base del back-office para los enlaces del aviso, sin barra final. */
    backofficeUrl: string;
  };
}

const toAppConfig = (env: Env): AppConfig => ({
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  app: { name: env.APP_NAME, version: env.APP_VERSION },
  logging: { level: env.LOG_LEVEL, pretty: env.LOG_PRETTY },
  http: { host: env.HTTP_HOST, port: env.HTTP_PORT, corsOrigins: env.CORS_ORIGINS },
  database: { url: env.DATABASE_URL },
  providers: {
    llm: env.LLM_PROVIDER,
    embedding: env.EMBEDDING_PROVIDER,
    property: env.PROPERTY_PROVIDER,
    vectorStore: env.VECTOR_STORE,
    credentials: {
      ...(env.OPENAI_API_KEY ? { openaiApiKey: env.OPENAI_API_KEY } : {}),
      ...(env.ANTHROPIC_API_KEY ? { anthropicApiKey: env.ANTHROPIC_API_KEY } : {}),
      ...(env.GEMINI_API_KEY ? { geminiApiKey: env.GEMINI_API_KEY } : {}),
      ollamaBaseUrl: env.OLLAMA_BASE_URL,
    },
    models: {
      ...(env.ANTHROPIC_MODEL ? { anthropic: env.ANTHROPIC_MODEL } : {}),
      ...(env.OPENAI_MODEL ? { openai: env.OPENAI_MODEL } : {}),
      ollama: env.OLLAMA_MODEL,
    },
    llmRuntime: {
      effort: env.LLM_EFFORT,
      timeoutMs: env.LLM_TIMEOUT_MS,
      maxRetries: env.LLM_MAX_RETRIES,
    },
    embeddings: {
      openaiModel: env.OPENAI_EMBEDDING_MODEL,
      ollamaModel: env.OLLAMA_EMBEDDING_MODEL,
      batchSize: env.EMBEDDING_BATCH_SIZE,
      timeoutMs: env.EMBEDDING_TIMEOUT_MS,
    },
  },
  agent: {
    maxToolIterations: env.AGENT_MAX_TOOL_ITERATIONS,
    maxToolCalls: env.AGENT_MAX_TOOL_CALLS,
    turnTimeoutMs: env.AGENT_TURN_TIMEOUT_MS,
    turnDebounceMs: env.AGENT_TURN_DEBOUNCE_MS,
    turnDebounceMaxMs: env.AGENT_TURN_DEBOUNCE_MAX_MS,
    monthlyBudgetUsd: env.TENANT_MONTHLY_BUDGET_USD,
  },
  whatsapp: {
    // Ambos o ninguno: con App Secret pero sin token de verificación el webhook
    // no se puede dar de alta, y al revés no se puede comprobar la firma.
    enabled: Boolean(env.WHATSAPP_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN),
    appSecret: env.WHATSAPP_APP_SECRET ?? "",
    verifyToken: env.WHATSAPP_VERIFY_TOKEN ?? "",
    graphUrl: env.WHATSAPP_GRAPH_URL,
    apiVersion: env.WHATSAPP_API_VERSION,
    timeoutMs: env.WHATSAPP_TIMEOUT_MS,
  },
  rateLimit: {
    tenantMessages: {
      perMinute: env.RATE_LIMIT_TENANT_MESSAGES_PER_MINUTE,
      burst: env.RATE_LIMIT_TENANT_MESSAGES_BURST,
    },
    contactTurns: {
      perMinute: env.RATE_LIMIT_CONTACT_TURNS_PER_MINUTE,
      burst: env.RATE_LIMIT_CONTACT_TURNS_BURST,
    },
  },
  metrics: {
    enabled: env.METRICS_ENABLED,
    ...(env.METRICS_TOKEN ? { token: env.METRICS_TOKEN } : {}),
  },
  storage: { driver: env.STORAGE_DRIVER, dir: env.STORAGE_DIR },
  knowledge: { maxDocumentBytes: env.KNOWLEDGE_MAX_DOCUMENT_BYTES },
  security: { encryptionKey: Buffer.from(env.ENCRYPTION_KEY, "base64") },
  notifications: {
    smtpEnabled: env.SMTP_HOST !== undefined,
    host: env.SMTP_HOST ?? "",
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER ? { user: env.SMTP_USER } : {}),
    ...(env.SMTP_PASSWORD ? { password: env.SMTP_PASSWORD } : {}),
    from: env.SMTP_FROM,
    timeoutMs: env.SMTP_TIMEOUT_MS,
    backofficeUrl: env.BACKOFFICE_URL.replace(/\/+$/, ""),
  },
});

export class ConfigurationError extends Error {
  constructor(issues: readonly z.ZodIssue[]) {
    const lines = issues.map((i) => `  · ${i.path.join(".") || "(raíz)"}: ${i.message}`);
    super(`Configuración de entorno inválida:\n${lines.join("\n")}`);
    this.name = "ConfigurationError";
  }
}

export const loadConfig = (source: NodeJS.ProcessEnv = process.env): AppConfig => {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) throw new ConfigurationError(parsed.error.issues);
  return toAppConfig(parsed.data);
};

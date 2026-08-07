import { z } from "zod";

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

    ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, {
        message: "ENCRYPTION_KEY debe ser 32 bytes en base64 (AES-256-GCM)",
      }),
  })
  /* Coherencia entre proveedores y credenciales: si eliges un proveedor real,
     su clave deja de ser opcional. El modo demo nunca exige nada. */
  .superRefine((env, ctx) => {
    const requireKey = (key: keyof typeof env, provider: string) => {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `Requerido cuando el proveedor es "${provider}". Usa LLM_PROVIDER=mock para el modo demo.`,
        });
      }
    };
    if (env.LLM_PROVIDER === "openai") requireKey("OPENAI_API_KEY", "openai");
    if (env.LLM_PROVIDER === "anthropic") requireKey("ANTHROPIC_API_KEY", "anthropic");
    if (env.LLM_PROVIDER === "gemini") requireKey("GEMINI_API_KEY", "gemini");
    if (env.EMBEDDING_PROVIDER === "openai") requireKey("OPENAI_API_KEY", "openai");

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
  };
  readonly storage: { driver: "local"; dir: string };
  readonly knowledge: { maxDocumentBytes: number };
  readonly security: { encryptionKey: Buffer };
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
  },
  agent: {
    maxToolIterations: env.AGENT_MAX_TOOL_ITERATIONS,
    maxToolCalls: env.AGENT_MAX_TOOL_CALLS,
    turnTimeoutMs: env.AGENT_TURN_TIMEOUT_MS,
    turnDebounceMs: env.AGENT_TURN_DEBOUNCE_MS,
    turnDebounceMaxMs: env.AGENT_TURN_DEBOUNCE_MAX_MS,
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
  storage: { driver: env.STORAGE_DRIVER, dir: env.STORAGE_DIR },
  knowledge: { maxDocumentBytes: env.KNOWLEDGE_MAX_DOCUMENT_BYTES },
  security: { encryptionKey: Buffer.from(env.ENCRYPTION_KEY, "base64") },
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

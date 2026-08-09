/**
 * Tablas que protege Row Level Security, y las que no.
 *
 * Esta lista es la frontera de la tercera capa de aislamiento entre
 * inmobiliarias (§10.1). Las dos primeras —`TenantContext` y `tenantScope()` en
 * cada repositorio— dependen de que el código no se equivoque, y ya se demostró
 * que puede: un `findById` sin ámbito sobrevivió seis fases. RLS es la capa que
 * no depende de que nadie se acuerde: la base se niega.
 *
 * Vive en TypeScript y no solo en el SQL de la migración para que sea legible,
 * revisable en un PR y comprobable por un test: hay uno que compara esta lista
 * con las tablas que de verdad tienen RLS activo en Postgres, así que una tabla
 * nueva con `tenant_id` que se olvide de proteger hace fallar el build.
 */

/** Datos de negocio. Nunca se leen sin saber de qué inmobiliaria son. */
export const RLS_PROTECTED_TABLES = [
  "agent_run_steps",
  "agent_runs",
  "appointment_events",
  "appointments",
  "audit_logs",
  "channel_deliveries",
  "contact_identities",
  "contact_profiles",
  "contacts",
  "conversations",
  "document_chunks",
  "documents",
  "knowledge_collections",
  "lead_events",
  "lead_property_interests",
  "leads",
  "messages",
  "profile_facts",
  "property_impressions",
  "property_snapshots",
  "tenant_usage_periods",
] as const;

/**
 * Exclusiones, cada una con su motivo.
 *
 * Que estén enumeradas y justificadas es parte del control: una exclusión sin
 * razón escrita es un agujero que nadie recuerda haber abierto.
 */
export const RLS_EXCLUDED_TABLES: Readonly<Record<string, string>> = {
  tenants:
    "Es el propio recurso: no tiene `tenant_id`, y el acceso se resuelve por id o por slug antes de que exista contexto alguno.",
  users:
    "El acceso al back-office resuelve el usuario ANTES de saber el tenant: es lo que se está autenticando.",
  sessions:
    "Validar la cookie ocurre antes de que exista contexto — de hecho es lo que lo establece.",
  user_tokens:
    "Mismo caso que `sessions`: el enlace de invitación o de restablecimiento llega sin sesión, y es el propio token el que resuelve a qué inmobiliaria pertenece. Con RLS no habría por dónde empezar a validarlo.",
  channel_accounts:
    "Es la consulta que DESCUBRE el tenant a partir de la cuenta por la que entró un mensaje (docs §7.1). Con RLS no habría por dónde empezar.",
  outbox_events:
    "Infraestructura del worker: el relay reserva lotes de todas las inmobiliarias a la vez, por diseño.",
  inbox_events:
    "Idempotencia de entrada, se consulta antes de resolver el tenant.",
} as const;

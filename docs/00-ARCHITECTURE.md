# Agente IA Inmobiliario — Documento de Arquitectura

> Estado: **DISEÑO** (v1.0) · Sin código todavía.
> Este documento es la fuente de verdad. Toda implementación debe poder trazarse a una sección de aquí.

---

## 0. Principios rectores (no negociables)

| # | Principio | Consecuencia práctica |
|---|---|---|
| 1 | **El dominio no conoce el mundo exterior** | Ninguna entidad, caso de uso ni el agente importan `axios`, `prisma`, `openai`, `whatsapp`. Solo interfaces. |
| 2 | **WhatsApp es un adaptador, no un módulo de negocio** | Si mañana borramos WhatsApp, el sistema sigue funcionando por Web/Telegram sin tocar un caso de uso. |
| 3 | **No conocemos el origen de los inmuebles** | `PropertyService` es un **puerto**. Wasi, DB propia o CSV son detalles intercambiables. Nunca aparece "Wasi" fuera de `infrastructure/`. |
| 4 | **El LLM es reemplazable y opcional** | `LLMProvider` es un puerto. El proyecto arranca y funciona **end-to-end sin ninguna API key**. |
| 5 | **El agente no inventa** | Todo dato factual proviene de una tool o de RAG con cita. Existe una capa de validación de *grounding* antes de responder. |
| 6 | **Determinismo donde se pueda, LLM donde aporte** | El estado de la conversación (slots, etapa, lead) es una máquina de estados determinista y testeable. El LLM aporta extracción y redacción, no reglas de negocio. |
| 7 | **Multi-tenant desde la línea 1** | Nada se implementa "para una inmobiliaria y luego lo generalizamos". Toda tabla y todo caso de uso llevan `tenantId`. |
| 8 | **Todo módulo se puede extraer a microservicio** | Comunicación entre módulos solo por: puerto público del módulo o evento. Nunca import cruzado a `internal/`. |

---

## 1. Arquitectura completa

### 1.1 Estilo

**Modular Monolith + Clean Architecture (Hexagonal) + DDD táctico + Event Driven interno.**

Un solo despliegue (`apps/api`), con módulos aislados como si fueran servicios. La extracción a microservicio se hace cambiando el transporte del bus de eventos y del cliente de módulo — no reescribiendo la lógica.

### 1.2 Diagrama de capas (regla de dependencia: siempre hacia adentro)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  INTERFACE / DELIVERY                                                    │
│  Webhooks de canal · REST admin · SSE streaming · WS inbox · Jobs · CLI  │
├──────────────────────────────────────────────────────────────────────────┤
│  APPLICATION                                                             │
│  Casos de uso · Orquestación del agente · Puertos (interfaces) · DTOs    │
├──────────────────────────────────────────────────────────────────────────┤
│  DOMAIN                                                                  │
│  Entidades · Value Objects · Agregados · Eventos de dominio · Políticas  │
├──────────────────────────────────────────────────────────────────────────┤
│  INFRASTRUCTURE (implementa puertos, nunca es importada por los de arriba)│
│  Prisma · pgvector · Providers LLM · Meta API · Queue · Storage · SMTP   │
└──────────────────────────────────────────────────────────────────────────┘
```

`Infrastructure` depende de `Application`+`Domain`. Jamás al revés. El único lugar donde se unen es el **Composition Root** (`bootstrap/container.ts`).

### 1.3 Vista de contenedores (C4 nivel 2)

```
   WhatsApp Cloud API ─┐
   Web Chat Widget ────┤
   Messenger / IG ─────┼──▶ [Channel Gateways] ──▶ Normalizador ──▶ Cola de turnos
   Telegram ───────────┘                                                  │
                                                                          ▼
                                                              ┌────────────────────┐
   Back-office React ──▶ REST/SSE ──────────────────────────▶ │   API (Fastify)    │
                                                              │  Modular Monolith  │
                                                              └─────────┬──────────┘
                                                                        │
                    ┌───────────────────┬──────────────────┬────────────┴─────────┐
                    ▼                   ▼                  ▼                      ▼
              PostgreSQL          pgvector            LLM Provider          PropertyService
            (+ outbox, jobs)    (knowledge)      (Mock/OpenAI/Claude…)     (puerto externo)
```

### 1.4 Decisiones clave y su porqué

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| Modular monolith | Microservicios desde día 1 | Un agente conversacional necesita latencia baja y transacciones consistentes (mensaje + estado + lead). Microservicios ahora = complejidad sin beneficio. La modularidad da la opción de dividir cuando el equipo o la carga lo pidan. |
| Fastify | Express | Validación por schema nativa (JSON Schema/TypeBox), ~2x throughput, plugins con encapsulación que mapea 1:1 con módulos, soporte first-class de SSE y hooks tipados. |
| Awilix (DI) | tsyringe / InversifyJS | Sin decoradores ni `reflect-metadata`; contenedores *scoped* por request (perfectos para `TenantContext`); registro explícito → composition root legible y auditable. |
| Prisma | TypeORM / Drizzle | Migraciones y tipado maduros. **Prisma vive solo en `infrastructure`**: los repositorios devuelven entidades de dominio, nunca modelos de Prisma. |
| pgvector en el mismo Postgres | Pinecone / Qdrant | Una sola base para el MVP y años siguientes; búsqueda híbrida (vector + full-text) en una sola query transaccional. Detrás del puerto `VectorStore` para poder migrar. |
| Outbox transaccional | Publicar eventos "a mano" | Garantiza que nunca se pierde un `LeadCaptured` si el proceso muere. Es el mismo patrón que se usará al ir a microservicios. |
| Cola en Postgres (pg-boss) primero | Redis/BullMQ desde el inicio | Cero infraestructura adicional. Detrás del puerto `JobQueue`, migrar a BullMQ es cambiar un adaptador. |

---

## 2. Módulos

Cada módulo es un **bounded context** con su propio `domain / application / infrastructure`, un `index.ts` que expone **solo** su contrato público, y `internal/` que nadie más puede importar (enforced por ESLint `no-restricted-imports` + Dependency Cruiser en CI).

| Módulo | Responsabilidad | Publica eventos | Consume |
|---|---|---|---|
| `platform` | Kernel compartido: Result, errores, ids, reloj, logger, EventBus, Outbox, DI, config, TenantContext. No es un contexto de negocio. | — | — |
| `identity` | Tenants, usuarios internos, roles, API keys, settings del tenant. | `TenantCreated` | — |
| `channels` | Adaptadores de canal. Normaliza entrante, renderiza saliente, describe capacidades. | `InboundMessageReceived`, `OutboundMessageDelivered/Failed` | `ReplyReady` |
| `conversation` | Contactos, conversaciones, mensajes, estado del turno, memoria estructurada y resúmenes. | `ConversationStarted`, `MessagePersisted`, `ConversationIdle`, `ConversationClosed` | `InboundMessageReceived` |
| `agent` | Runtime del agente: construcción de contexto, ciclo de tool-calling, políticas, guardrails, prompts versionados. | `AgentRunCompleted/Failed`, `ReplyReady`, `HandoffRequested` | `TurnReady` |
| `catalog` | **Puerto** `PropertyService` + caché/snapshots de propiedades mostradas. No es dueño del catálogo. | `PropertySearchPerformed`, `PropertyShown` | — |
| `leads` | Lead, calificación, scoring, asignación a asesor, pipeline. | `LeadCaptured`, `LeadQualified`, `LeadAssigned` | `PropertyShown`, `AgentRunCompleted` |
| `appointments` | Solicitud, disponibilidad, confirmación, recordatorio y cancelación de visitas. | `AppointmentRequested/Confirmed/Cancelled`, `AppointmentReminderDue` | `LeadQualified` |
| `knowledge` | RAG: colecciones, documentos, ingesta, chunking, embeddings, retrieval híbrido. | `DocumentIngested`, `DocumentIndexed`, `IngestionFailed` | — |
| `notifications` | Envío a asesores/humanos por email, push, canal interno. Plantillas. | `NotificationSent/Failed` | casi todos |
| `handoff` | Escalamiento a humano: cola de atención, toma de control, pausa del bot, devolución al bot. | `HandoffOpened/Taken/Closed` | `HandoffRequested` |
| `analytics` | Métricas, costes por tenant, calidad conversacional, embudo. Solo lectura de eventos. | — | todos |

> **Nota sobre `catalog`:** no modela inmuebles. Modela *referencias* a inmuebles (`PropertyRef = { source, externalId }`) y *snapshots* inmutables de lo que se le mostró al cliente, para que un lead o una cita puedan referenciar un inmueble sin que nosotros seamos dueños del catálogo.

### 2.1 Reglas de comunicación entre módulos

1. **Síncrona:** solo a través del puerto público de otro módulo, inyectado por DI. Ej.: `agent` usa `PropertyService` (puerto de `catalog`).
2. **Asíncrona:** eventos de integración vía `EventBus` (outbox). Ej.: `leads` reacciona a `PropertyShown`.
3. **Prohibido:** joins SQL entre tablas de módulos distintos y `import` a `internal/`.

---

## 3. Capas (contrato interno de cada módulo)

```
modules/<modulo>/
├── domain/
│   ├── entities/            # Agregados con invariantes. Sin decoradores, sin ORM.
│   ├── value-objects/       # Money, PhoneNumber, PropertyRef, SearchCriteria…
│   ├── events/              # Eventos de dominio (pasado, inmutables)
│   ├── policies/            # Reglas puras: LeadScoringPolicy, EscalationPolicy
│   ├── errors/              # DomainError tipados
│   └── repositories/        # Interfaces de persistencia (puertos driven)
├── application/
│   ├── use-cases/           # Un archivo = un caso de uso = una clase con execute()
│   ├── ports/               # Puertos hacia fuera: LLMProvider, PropertyService…
│   ├── dto/                 # Entrada/salida, validados con Zod
│   ├── mappers/             # Domain ⇄ DTO
│   └── event-handlers/      # Reacciones a eventos de otros módulos
├── infrastructure/
│   ├── persistence/prisma/  # Repos concretos + mappers Prisma ⇄ Domain
│   ├── providers/           # Clientes HTTP, SDKs, LLM providers
│   └── config/              # Schema de env del módulo
├── interface/
│   ├── http/                # Rutas Fastify + schemas
│   ├── jobs/                # Consumers de cola
│   └── ws/                  # SSE / WebSocket
└── index.ts                 # Contrato público del módulo
```

**Regla de oro del caso de uso:** recibe DTO validado, orquesta dominio + puertos, devuelve DTO. No conoce HTTP, ni Prisma, ni el canal.

---

## 4. Estructura de carpetas (monorepo)

```
agentInmobi/
├── apps/
│   ├── api/
│   │   ├── prisma/
│   │   │   ├── schema/                 # schema modular (un .prisma por módulo)
│   │   │   ├── migrations/
│   │   │   └── seed/
│   │   └── src/
│   │       ├── main.ts                 # arranque
│   │       ├── bootstrap/
│   │       │   ├── container.ts        # COMPOSITION ROOT
│   │       │   ├── modules.registry.ts # registro y orden de módulos
│   │       │   ├── server.ts           # Fastify + plugins
│   │       │   └── worker.ts           # proceso de jobs (mismo código, otro entrypoint)
│   │       ├── platform/
│   │       │   ├── result/             # Result<T,E>, no excepciones para flujo esperado
│   │       │   ├── errors/
│   │       │   ├── events/             # EventBus, Outbox, Inbox, tipos base
│   │       │   ├── di/
│   │       │   ├── config/             # env validado con Zod, tipado
│   │       │   ├── logging/            # pino + correlationId
│   │       │   ├── observability/      # OpenTelemetry, métricas
│   │       │   ├── tenancy/            # TenantContext (AsyncLocalStorage)
│   │       │   ├── clock/ ids/ crypto/
│   │       │   └── testing/            # dobles de prueba compartidos
│   │       └── modules/
│   │           ├── identity/
│   │           ├── channels/
│   │           │   ├── domain/         # ChannelType, ChannelCapabilities, OutboundBlock
│   │           │   ├── application/    # NormalizeInbound, DispatchReply
│   │           │   └── infrastructure/adapters/
│   │           │       ├── whatsapp/   # ← ÚNICO lugar con "whatsapp" en el nombre
│   │           │       ├── webchat/
│   │           │       ├── telegram/
│   │           │       └── console/    # canal de desarrollo por CLI
│   │           ├── conversation/
│   │           ├── agent/
│   │           │   ├── domain/         # AgentRun, AgentStep, ToolCall, Guardrail
│   │           │   ├── application/
│   │           │   │   ├── runtime/    # AgentOrchestrator, ContextBuilder, ToolRegistry
│   │           │   │   ├── tools/      # definiciones de tools (schemas + binding a puertos)
│   │           │   │   ├── prompts/    # PromptRegistry (versionado)
│   │           │   │   └── guardrails/
│   │           │   └── infrastructure/llm/
│   │           │       ├── mock/       # MockLLMProvider  ← modo demo
│   │           │       ├── recorded/   # VCR para tests
│   │           │       ├── openai/
│   │           │       ├── anthropic/
│   │           │       ├── gemini/
│   │           │       └── ollama/
│   │           ├── catalog/
│   │           │   └── infrastructure/providers/
│   │           │       ├── mock/       # MockPropertyService  ← modo demo
│   │           │       └── http/       # adaptador genérico configurable
│   │           ├── leads/
│   │           ├── appointments/
│   │           ├── knowledge/
│   │           ├── notifications/
│   │           ├── handoff/
│   │           └── analytics/
│   └── web/                            # React + Vite (back-office)
│       └── src/
│           ├── app/                    # router, providers, layout
│           ├── features/               # inbox, leads, appointments, knowledge,
│           │                           # agent-playground, settings, analytics
│           ├── entities/               # modelos de UI
│           ├── shared/                 # ui-kit, api client, hooks
│           └── widgets/
├── packages/
│   ├── contracts/                      # Zod + tipos compartidos API ⇄ Web
│   ├── config-eslint/  config-ts/
│   └── testing/
├── docs/
│   ├── 00-ARCHITECTURE.md              # este documento
│   ├── adr/                            # Architecture Decision Records
│   └── diagrams/
└── docker-compose.yml                  # postgres+pgvector, mailpit, adminer
```

---

## 5. Entidades y Value Objects

### 5.1 Identity
- **Tenant** (agregado): `id, slug, name, status, plan, locale, timezone, currency, settings`.
- **TenantSettings** (VO): persona del agente, tono, horario de atención, política de escalamiento, límites de uso.
- **User**: asesor/admin del tenant. `role: OWNER|ADMIN|AGENT|VIEWER`.

### 5.2 Conversation (agregado raíz: `Conversation`)
- **Contact**: `id, tenantId, displayName, primaryPhone?, email?, locale, tags[]`.
- **ContactIdentity**: `(channelType, externalId)` → `contactId`. Un contacto puede tener varias identidades (mismo humano en WhatsApp e Instagram).
- **Conversation**: `id, tenantId, contactId, channelAccountId, status(OPEN|BOT_PAUSED|HUMAN|CLOSED), stage, lastActivityAt, assignedUserId?`.
- **Message**: `id, conversationId, direction(INBOUND|OUTBOUND), authorType(CONTACT|AGENT|HUMAN|SYSTEM), blocks[], providerMessageId, status, sentAt`.
- **ConversationSummary**: resumen comprimido de mensajes antiguos (rolling summary).
- **ContactProfile** ← *memoria estructurada*, ver §11.

**Invariantes:** no se puede agregar un mensaje a una conversación `CLOSED`; `providerMessageId` es único por canal (idempotencia de webhooks).

### 5.3 Agent
- **AgentRun**: una ejecución del agente para un turno. `id, conversationId, status, steps[], tokensIn/Out, costEstimate, latencyMs, model, promptVersion`.
- **AgentStep**: `type(THOUGHT|TOOL_CALL|TOOL_RESULT|MESSAGE|GUARDRAIL)`, payload, duración.
- **ToolCall** (VO): `name, args, callId`.
- **AgentReply** (VO): lista de **bloques agnósticos de canal** (§7.4).
- **AgentConfig**: persona, temperatura, tools habilitadas, versión de prompt, política de handoff. Por tenant.

### 5.4 Catalog
- **PropertyRef** (VO): `{ source, externalId }` — identidad estable e independiente del proveedor.
- **PropertySnapshot**: copia inmutable de lo mostrado (`title, price, currency, city, neighborhood, type, bedrooms, bathrooms, areaM2, images[], url, capturedAt`). Sirve para auditar "qué le prometimos al cliente".
- **SearchCriteria** (VO): `operation(SALE|RENT), propertyType[], city, neighborhoods[], priceRange, bedroomsMin, bathroomsMin, areaMin, features[]`. **Es el mismo VO que usa la memoria de slots.**

### 5.5 Leads
- **Lead** (agregado): `id, tenantId, contactId, conversationId, source(channel), status(NEW|CONTACTED|QUALIFIED|SCHEDULED|WON|LOST)`, `criteria: SearchCriteria`, `interestedIn: PropertyRef[]`, `score`, `assignedUserId?`, `consent`.
- **LeadEvent**: histórico append-only de cambios.
- **LeadScore** (VO): calculado por `LeadScoringPolicy` (completitud de criterios + intención + interacción + presupuesto declarado).

### 5.6 Appointments
- **Appointment**: `id, tenantId, leadId, propertyRef, requestedAt, scheduledAt, durationMin, status(REQUESTED|CONFIRMED|RESCHEDULED|CANCELLED|COMPLETED|NO_SHOW), assignedUserId, location, notes`.
- **TimeSlot** (VO): `{ startsAt (UTC), durationMin }`, con una **referencia opaca** que es lo único que el modelo puede devolver (D20). Las franjas se derivan del horario del tenant en SU zona horaria, menos lo ocupado según el puerto `CalendarService` (adaptador interno sobre las citas ya agendadas).

### 5.7 Knowledge
- **KnowledgeCollection**: agrupador por tenant (ej. "Políticas", "FAQ", "Proyectos").
- **Document**: `id, collectionId, title, sourceType(UPLOAD|URL|TEXT), mimeType, checksum, status, version`.
- **DocumentChunk**: `id, documentId, ordinal, content, heading?, tokens, embeddingModel, embedding vector(1536), tsv`. `content` es texto LITERAL del documento: es lo que se cita. Al vectorizar se le antepone el epígrafe; a la cita, no.
- **Citation** (VO): `documentId, chunkId, title, score, excerpt`.

### 5.8 Handoff
- **HandoffTicket**: `id, conversationId, reason(USER_REQUEST|LOW_CONFIDENCE|NEGATIVE_SENTIMENT|TOOL_FAILURE|POLICY|BUSINESS_RULE), status, openedAt, takenBy, closedAt`.

---

## 6. Casos de uso

### conversation
- `IngestInboundMessage` — normaliza, resuelve tenant/contacto/conversación, persiste, agenda el turno.
- `AppendOutboundMessage`
- `GetConversationContext` — ventana + resumen + perfil.
- `UpdateContactProfile` — merge de slots con procedencia y confianza.
- `SummarizeConversation` — job periódico.
- `CloseConversation` / `PauseBot` / `ResumeBot`

### agent
- `RunAgentTurn` — **caso de uso central** (§7).
- `StreamAgentTurn` — variante con streaming para canales que lo soportan.
- `EvaluateGuardrails`
- `RegisterTool` / `ResolveEnabledTools`
- `RenderPrompt` (versionado por tenant)
- `ReplayAgentRun` — re-ejecutar un run con fixtures para depurar/tests de regresión.

### catalog
- `SearchProperties(criteria, pagination)` → usa puerto `PropertyService`
- `GetPropertyDetails(ref)`
- `CheckAvailability(ref)`
- `GetPropertyMedia(ref)`
- `RecordPropertyShown(conversationId, refs[])` → snapshot + evento

### leads
- `CaptureLead` (idempotente por conversación)
- `UpdateLeadCriteria`
- `QualifyLead` (política de scoring)
- `AssignLead`
- `ChangeLeadStatus`
- `ListLeads` (back-office, filtros + paginación)

### appointments
- `ProposeAppointmentSlots`
- `RequestAppointment`
- `ConfirmAppointment` / `RescheduleAppointment` / `CancelAppointment`
- `SendAppointmentReminder` (job)

### knowledge
- `CreateCollection`
- `IngestDocument` (upload/url/texto) → job asíncrono
- `ReindexDocument` / `DeleteDocument`
- `SearchKnowledge(query, filters, topK)` → chunks + citas
- `AnswerFromKnowledge(question)` → respuesta con citas o `NO_ANSWER`

### handoff
- `RequestHandoff` / `TakeOverConversation` / `ReturnToBot` / `ListHandoffQueue`

### notifications
- `NotifyAdvisor` / `SendTemplateMessage`

### identity
- `CreateTenant`, `InviteUser`, `Authenticate`, `RotateApiKey`, `UpdateAgentConfig`

---

## 7. Flujo de mensajes (end-to-end)

### 7.1 Entrada

```
1. POST /webhooks/:channel/:channelAccountId
2. ChannelGateway verifica firma (HMAC) y responde 200 INMEDIATAMENTE
3. InboundMessageMapper → InboundMessage canónico:
     { channelType, channelAccountId, externalMessageId, externalContactId,
       content: Block[], receivedAt, raw }
4. Idempotencia: si externalMessageId ya existe → descartar
5. TenantResolver: channelAccountId → tenantId  (nunca se confía en el payload)
6. RateLimiter: cubo de fichas por tenant, cost = mensajes del lote
     → agotado: 429 + Retry-After  (el proveedor reintenta; nada se pierde)
7. IngestInboundMessage: resuelve/crea Contact + Conversation, persiste Message
8. Emite InboundMessageReceived → encola TurnScheduler
```

**El paso 6 va después del 5 y no antes, y eso no es casual.** El límite global de Fastify cuenta por IP, y por la IP de un proveedor entran los mensajes de todas las inmobiliarias: cortar ahí castigaría a las demás por el bucle de una. Solo aquí se sabe de quién es el tráfico (D60).

### 7.2 Buffer de turno (detalle crítico del mundo real)

El usuario de WhatsApp escribe *"hola"* / *"busco apto"* / *"en Medellín"* en 3 mensajes seguidos.

```
TurnScheduler:
  - debounce configurable (por defecto 2.5 s de silencio, máx 8 s)
  - agrupa los mensajes pendientes en UN turno
  - lock por conversationId (advisory lock de Postgres) → nunca 2 turnos en paralelo
  - emite TurnReady
```

**Implementado en F1.** Dos relojes, no uno: el silencio se reinicia con cada mensaje, pero el tope máximo no — sin él, quien escribe sin parar nunca recibiría respuesta. La pertenencia de un mensaje a un turno vive en la columna `messages.turn_id`, no en memoria: si el proceso muere, los mensajes siguen pendientes y el siguiente turno los arrastra. `TurnScheduler` es un **puerto**; hoy lo implementan temporizadores en proceso y en F2 pasará a pg-boss (decisión D2) sin tocar ningún caso de uso.

### 7.3 Ciclo del agente (`RunAgentTurn`)

```
┌─ 1. Cargar contexto ──────────────────────────────────────────────────┐
│  AgentConfig(tenant) + ConversationWindow + Summary + ContactProfile   │
│  + ChannelCapabilities + Tools habilitadas                            │
└───────────────────────────────────────────────────────────────────────┘
                              ▼
┌─ 1b. Puertas baratas (nada de esto llama al modelo) ──────────────────┐
│  ¿El bot sigue al mando? → un humano tomó la conversación: SKIPPED    │
│  RateLimiter por contacto → agotado: turno omitido + 1 aviso/10 min   │
│  SpendLimit del mes        → agotado: handoff a una persona           │
└───────────────────────────────────────────────────────────────────────┘
                              ▼
┌─ 2. Pre-procesado determinista ───────────────────────────────────────┐
│  SlotExtractor (LLM structured output o reglas en modo mock)          │
│  → actualiza ContactProfile (con confianza y procedencia)             │
│  IntentClassifier → GREETING | SEARCH | QUESTION | FAQ | SCHEDULE |   │
│                      HANDOFF | SMALLTALK | OUT_OF_SCOPE               │
│  EscalationPolicy → ¿handoff inmediato?                               │
└───────────────────────────────────────────────────────────────────────┘
                              ▼
┌─ 3. Bucle de tool calling (máx N iteraciones, presupuesto y timeout) ─┐
│  LLMProvider.generate(messages, toolSchemas)                          │
│    ├─ ¿pide tools? → ToolRegistry.execute() en paralelo cuando aplica │
│    │                  (validación Zod de args + tenant scope + audit) │
│    │                  → resultado se añade como TOOL_RESULT           │
│    └─ ¿respuesta final? → salir del bucle                             │
└───────────────────────────────────────────────────────────────────────┘
                              ▼
┌─ 4. Guardrails (post-generación) ─────────────────────────────────────┐
│  GroundingValidator: precios/direcciones/nombres citados ⊆ tool results│
│  CitationValidator: respuestas de conocimiento llevan cita            │
│  PIIPolicy · LengthPolicy · SafetyPolicy                              │
│  Falla → 1 reintento con feedback → si falla otra vez → handoff       │
└───────────────────────────────────────────────────────────────────────┘
                              ▼
┌─ 5. Composición de la respuesta ──────────────────────────────────────┐
│  AgentReply = Block[]  (agnóstico de canal, §7.4)                     │
│  Las fichas de inmueble se RENDERIZAN de los datos de la tool,        │
│  no de texto del LLM → cero alucinación de precios                    │
└───────────────────────────────────────────────────────────────────────┘
                              ▼
┌─ 6. Salida ───────────────────────────────────────────────────────────┐
│  Emite ReplyReady → ChannelDispatcher                                 │
│  ChannelRenderer(capabilities) adapta bloques al canal                │
│  ChatChannel.send() → persiste OUTBOUND + estado de entrega           │
│  AgentRun persistido completo (steps, tokens, coste, latencia)        │
└───────────────────────────────────────────────────────────────────────┘
```

### 7.4 Bloques de respuesta (contrato agnóstico de canal)

```ts
type ReplyBlock =
  | { kind: 'text';          text: string }
  | { kind: 'property_card'; ref: PropertyRef; snapshot: PropertySnapshot }
  | { kind: 'property_list'; items: PropertyCard[]; more?: boolean }
  | { kind: 'quick_replies'; prompt: string; options: Option[] }
  | { kind: 'media';         url: string; mediaType: 'image'|'video'|'doc'; caption?: string }
  | { kind: 'link';          url: string; label: string }
  | { kind: 'form_request';  fields: FieldSpec[] }        // web chat
  | { kind: 'handoff_notice'; reason: string }
```

**Degradación por capacidades:** si el canal no soporta `quick_replies`, el renderer los convierte en lista numerada de texto. Si no soporta carruseles, envía tarjetas secuenciales. El agente nunca se entera.

---

## 8. Flujo de herramientas (Tools)

### 8.1 Contrato

```ts
interface AgentTool<A, R> {
  name: string;                       // search_properties
  description: string;                // se envía al LLM
  parameters: ZodSchema<A>;           // → JSON Schema para el provider
  scopes: ToolScope[];                // permisos requeridos
  sideEffects: 'none' | 'write';      // las de escritura requieren confirmación
  execute(args: A, ctx: ToolContext): Promise<ToolResult<R>>;
}
```

`ToolContext` = `{ tenantId, conversationId, contactId, correlationId, logger, abortSignal }`.
La tool **nunca** recibe el tenant por argumento del LLM — se inyecta del contexto. Esto elimina la clase entera de ataques de *prompt injection* de acceso cruzado entre tenants.

### 8.2 Catálogo inicial de tools

| Tool | Puerto que consume | Efecto |
|---|---|---|
| `search_properties` | `PropertyService.search` | read |
| `get_property_details` | `PropertyService.getById` | read |
| `check_property_availability` | `PropertyService.checkAvailability` | read |
| `get_property_media` | `PropertyService.getMedia` | read |
| `search_knowledge` | `KnowledgeService.search` | read |
| `save_customer_preferences` | `ConversationMemory.update` | write |
| `register_lead` | `LeadService.capture` | write |
| `propose_visit_slots` | `AppointmentService.proposeSlots` | read |
| `schedule_visit` | `AppointmentService.request` | write |
| `request_human_agent` | `HandoffService.request` | write |
| `notify_advisor` | `NotificationService.notify` | write |

### 8.3 Reglas de ejecución
- Validación **estricta** de argumentos (Zod). Argumento inválido → `ToolResult.error` devuelto al LLM para autocorrección, no excepción.
- Timeout por tool + `AbortSignal`. Fallo → resultado estructurado `{ ok:false, code:'UPSTREAM_TIMEOUT' }`; el agente lo explica al usuario sin inventar.
- Tools `write` son **idempotentes** (clave = `conversationId + tool + hash(args)`).
- Toda ejecución se audita en `agent_run_steps` (args, resultado truncado, duración, error).
- Presupuesto por turno: máx 6 iteraciones, máx 10 tools, timeout global 45 s → si se agota, respuesta parcial + handoff.

---

## 9. Eventos

### 9.1 Mecánica
- **Eventos de dominio**: se acumulan en el agregado, se despachan tras el commit.
- **Eventos de integración**: se escriben en `outbox_events` **en la misma transacción** que el cambio de estado. Un relay los publica al `EventBus`.
- **Bus**: en proceso (EventEmitter tipado) hoy → Redis Streams / SQS mañana, mismo puerto.
- **Consumidores idempotentes** con tabla `inbox_events` (dedupe por `eventId + handler`).
- Envelope común: `{ eventId, type, version, tenantId, occurredAt, correlationId, causationId, payload }`.

### 9.2 Catálogo

| Evento | Emisor | Consumidores |
|---|---|---|
| `channels.inbound_message_received` | channels | conversation |
| `conversation.started` | conversation | analytics, notifications |
| `conversation.turn_ready` | conversation | agent *(en F1: `dev-echo`, andamiaje temporal)* |
| `conversation.message_persisted` | conversation | analytics |
| `channels.outbound_message_delivered/failed` | channels | analytics, conversation |
| `identity.tenant_created` | identity | analytics, notifications |
| `conversation.idle` | conversation (job) | agent (seguimiento), leads |
| `agent.run_completed` | agent | analytics, leads |
| `agent.run_failed` | agent | handoff, notifications |
| ~~`agent.reply_ready`~~ | — | *Sustituido por la llamada directa al puerto de `conversation` (decisión D12).* |
| `catalog.property_search_performed` | catalog | analytics |
| `catalog.property_shown` | catalog | leads |
| `lead.captured` | leads | notifications, analytics |
| `lead.qualified` | leads | notifications, analytics |
| `lead.assigned` | leads | notifications |
| `lead.status_changed` | leads | analytics, back-office (F7) |
| `appointment.requested` | appointments | notifications, handoff |
| `appointment.confirmed` | appointments | notifications, analytics |
| `appointment.rescheduled` / `appointment.cancelled` | appointments | notifications, analytics |
| `appointment.reminder_due` | appointments (job) | appointments (aviso por el canal del cliente), notifications |
| `handoff.requested` | agent | handoff |
| `handoff.opened` | handoff | notifications, conversation (pausa bot) |
| `handoff.closed` | handoff | conversation (reanuda bot) |
| `knowledge.document_ingested` | knowledge | knowledge (indexado) |
| `knowledge.document_indexed` | knowledge | analytics |

---

## 10. Base de datos

PostgreSQL 16 + extensiones `vector`, `pg_trgm`, `unaccent`.

### 10.1 Multi-tenancy
Base compartida, `tenant_id NOT NULL` en toda tabla de negocio, índice compuesto `(tenant_id, …)` siempre primero. **Defensa en profundidad:**
1. `TenantContext` en `AsyncLocalStorage`, inyectado en el scope de request.
2. Repositorio base que añade `tenantId` a todo `where` — imposible olvidarlo.
3. **Row Level Security** de Postgres con `SET LOCAL app.tenant_id` por transacción.

### 10.2 Tablas (resumen)

**identity**: `tenants`, `tenant_settings`, `users`, `user_tenants`, `api_keys`, `agent_configs`, `prompt_templates`

**channels**: `channel_accounts` (credenciales cifradas, tipo, config, `tenant_id`), `channel_deliveries`

**conversation**: `contacts`, `contact_identities` *(uq: **tenant_id**+channel_type+external_id)*, `conversations`, `messages` *(uq: **tenant_id**+external_message_id)*, `conversation_summaries` *(F2)*, `contact_profiles` *(memoria estructurada, JSONB con procedencia y confianza)*, `profile_facts` *(histórico append-only)*

> **Corrección aplicada en F1.** Este documento decía `uq: channel_type+external_id` para `contact_identities`. Es incorrecto en multi-tenant: la misma persona, con el mismo teléfono, puede escribir a dos inmobiliarias distintas, y para cada una es un cliente distinto con su propia memoria. Con la unicidad global, el segundo tenant se quedaba sin fila de identidad y recreaba el contacto en cada mensaje. La unicidad correcta incluye `tenant_id`. Lo detectó la prueba de aislamiento entre tenants, no una revisión de código.
>
> Los bloques de mensaje van en una columna JSONB dentro de `messages`, no en una tabla `message_blocks`: se leen y escriben siempre con el mensaje, nunca por separado, y una tabla aparte solo añadiría un join a cada carga de la ventana de contexto.

**agent**: `agent_runs`, `agent_run_steps`, `tool_invocations`, `guardrail_violations`

**catalog**: `property_snapshots` *(uq: tenant_id+source+external_id+checksum)*, `property_impressions`

**leads**: `leads` *(uq: tenant_id+conversation_id — la idempotencia de la captura)*, `lead_events`, `lead_property_interests` *(uq: lead_id+property_ref)*

**appointments**: `appointments`, `appointment_events` — sin `advisor_availability` (decisión D23: la disponibilidad se deriva del horario del tenant menos las citas agendadas, tras el puerto `CalendarService`)

**knowledge**: `knowledge_collections`, `documents` *(uq: tenant_id+collection_id+checksum — la idempotencia de la ingesta)*, `document_chunks` *(embedding `vector(1536)` + HNSW, `tsv` **columna generada** `to_tsvector('spanish', f_unaccent(heading‖content))` + GIN)*. Sin `ingestion_jobs`: la cola es el outbox, que ya garantiza entrega y reintentos.

**handoff**: `handoff_tickets`, `handoff_events`

**notifications**: `notification_templates`, `notifications`

**platform**: `outbox_events`, `inbox_events`, `jobs` (pg-boss), `audit_logs`, `usage_counters` (tokens/coste por tenant y día)

### 10.3 Índices críticos
- `document_chunks`: HNSW sobre `embedding` (`vector_cosine_ops`) + GIN sobre `tsv` → **búsqueda híbrida con fusión RRF**.
- `messages (conversation_id, sent_at DESC)`
- `conversations (tenant_id, status, last_activity_at DESC)`
- `outbox_events (status, available_at)` para el barrido del relay.
- `contact_identities (tenant_id, channel_type, external_id)` único.
- `messages (conversation_id, turn_id)` → buffer de turno: mensajes sin turno asignado.
- `channel_accounts (channel_type, external_id)` único **global**: es lo que resuelve el tenant de un mensaje entrante, y por eso aquí la unicidad sí cruza tenants.

### 10.4 Lo que NO está en nuestra base
Los inmuebles. Solo guardamos `PropertyRef` + snapshots. Si el tenant cambia de Wasi a otro CRM, no migramos datos de catálogo.

---

## 11. Memoria

Tres capas, **todas independientes del proveedor de IA**. El LLM nunca decide qué se recuerda; recibe un contexto ya construido.

| Capa | Qué guarda | Dónde | Duración |
|---|---|---|---|
| **Working memory** | Últimos N mensajes (ventana por tokens) | `messages` | Turno |
| **Structured memory** | `ContactProfile`: nombre, presupuesto, ciudad, barrios, tipo, habitaciones, baños, área, operación, urgencia, forma de pago, preferencias libres, consentimiento | `contact_profiles` (columnas + JSONB) | Permanente |
| **Episodic / summary** | Resumen rodante de la conversación | `conversation_summaries` | Permanente |
| *(fase 2)* **Semantic** | Hechos vectorizados del contacto para recuperar por similitud | `profile_facts` + pgvector | Permanente |

### 11.1 ContactProfile — modelo de slots

```ts
interface ProfileSlot<T> {
  value: T;
  confidence: number;        // 0..1
  source: 'user' | 'inferred' | 'advisor' | 'crm';
  updatedAt: Date;
}

interface ContactProfile {
  tenantId; contactId;
  name?:         ProfileSlot<string>;
  operation?:    ProfileSlot<'SALE'|'RENT'>;
  propertyType?: ProfileSlot<PropertyType[]>;
  city?:         ProfileSlot<string>;
  neighborhoods?:ProfileSlot<string[]>;
  budget?:       ProfileSlot<MoneyRange>;
  bedrooms?:     ProfileSlot<number>;
  bathrooms?:    ProfileSlot<number>;
  areaM2?:       ProfileSlot<Range>;
  features?:     ProfileSlot<string[]>;
  timeline?:     ProfileSlot<'now'|'1-3m'|'3-6m'|'exploring'>;
  financing?:    ProfileSlot<'cash'|'mortgage'|'unknown'>;
  consent?:      ProfileSlot<ConsentState>;
  freeNotes:     string[];
}
```

**Reglas de merge:** un valor `source:'user'` siempre gana sobre `inferred`. Un valor más reciente gana sobre uno antiguo del mismo `source`. Toda escritura queda en `profile_facts` (append-only, auditable). El usuario puede corregirse ("no, mejor en Envigado") y el sistema lo respeta sin ambigüedad.

**Por qué esto importa:** la política de "qué falta preguntar" es una función pura sobre `ContactProfile` → testeable, determinista, y funciona idéntico con MockLLM o con GPT-5.

### 11.2 ContextBuilder
Ensambla, con presupuesto de tokens explícito y prioridades:
`SystemPrompt(persona del tenant) + ProfileSummary + Summary + Ventana de mensajes + ToolSchemas + ChannelHints`.
Si no cabe: primero recorta ventana, luego resumen, nunca el perfil ni las reglas de negocio.

---

## 12. Conversaciones

### 12.1 Máquina de estados

```
        ┌──────────────────────────────────────────────────┐
        ▼                                                  │
   NEW ──▶ DISCOVERY ──▶ SEARCHING ──▶ PRESENTING ──▶ SCHEDULING ──▶ CLOSED
             │  ▲            │  ▲          │                │
             │  └────────────┴──┴──────────┘  (refinamiento)│
             ▼                                              ▼
          HANDOFF ◀────────────────────────────────── (en cualquier punto)
             │
             ▼
        HUMAN_ACTIVE ──▶ (devolver al bot) ──▶ estado anterior
```

- **DISCOVERY**: faltan slots obligatorios (`operation`, `city`, `propertyType`, `budget`). El agente pregunta **máximo 2 datos por mensaje**.
- **SEARCHING**: hay criterios suficientes → `search_properties`.
- **PRESENTING**: se muestran 3–5 opciones máximo, con opción de refinar.
- **SCHEDULING**: lead capturado + intención de visita.
- **HANDOFF**: bot pausado; ningún mensaje saliente automático mientras `HUMAN_ACTIVE`.

### 12.2 Políticas de escalamiento a humano
Se dispara `HandoffRequested` cuando:
1. El usuario lo pide explícitamente.
2. Dos turnos seguidos con guardrail fallido o sin resultados útiles.
3. Intención fuera de alcance (legal, negociación de precio, reclamo).
4. Sentimiento negativo sostenido.
5. Fallo de proveedor (LLM o PropertyService) tras reintentos.
6. Regla de negocio del tenant (ej.: presupuesto > X).

### 12.3 Reanudación y seguimiento
- `ConversationIdle` (sin respuesta > 24 h): job de seguimiento, respetando ventana de 24 h de WhatsApp y plantillas aprobadas.
- Al volver el contacto días después: se recupera `ContactProfile` completo → *"Hola Ana, ¿seguimos buscando apartamento de 3 habitaciones en Laureles hasta 450 millones?"*.

### 12.4 Streaming
- `ChannelCapabilities.supportsStreaming`: web chat → SSE token a token; WhatsApp → buffer y envío en 1–3 mensajes con `typing indicator`.
- El orquestador emite el mismo stream de eventos; solo cambia el sink.

---

## 12 bis. Observabilidad

Tres capas que responden preguntas distintas, y confundirlas es el error caro:

| Capa | Pregunta que responde | Dónde vive |
|---|---|---|
| **Métricas** | ¿Cuánto entra, cuánto tarda, cuánto falla, cuánto se acumula? | `GET /metrics` |
| **Logs** | ¿Qué le pasó a ESTA conversación de ESTA inmobiliaria? | `correlationId` + `tenantId` |
| **Traza del turno** | ¿Qué hizo el agente paso a paso, y qué costó? | `agent_runs` · `agent_run_steps` |

La tercera es la que suele faltar en otros productos y aquí existe desde F2: cada
turno guarda sus pasos con argumentos, duración, modelo y coste. Por eso las
métricas **no** necesitan trazas distribuidas para explicar un turno lento — el
detalle ya está en la base, y con más contexto de negocio del que daría un span.

### Qué se mide

```
Tráfico     inbound_messages_total{channel,outcome}
            http_requests_total{method,route,status}
Servicio    agent_turns_total{status}          COMPLETED · ESCALATED · SKIPPED · FAILED
            agent_turns_blocked_total{reason}  spend_limit · rate_limit
Latencia    http_request_duration_seconds · llm_request_duration_seconds
            agent_turn_duration_seconds · agent_tool_duration_seconds
Coste       agent_tokens_total{kind} · agent_cost_usd_total{provider}
Saturación  outbox_lag_seconds   ← la señal temprana: si sube, hay clientes esperando
Salud       outbox_dead_lettered_total  ← distinto de cero se investiga siempre
Contexto    build_info{version,environment,llm_provider,embedding_provider}
```

`outbox_lag_seconds` se mide desde que el evento se **encoló**, no desde que se
reservó. Un evento que estuvo cuatro minutos en la cola y se entrega en dos
milisegundos no es una entrega rápida: es una cola que no da abasto.

### La regla que sostiene todo esto

**Ninguna etiqueta lleva un identificador** (D64). Ni tenant, ni conversación, ni
contacto, ni la URL con el id dentro, ni el mensaje de un error. Cada
combinación de etiquetas es una serie que el sistema de monitorización guarda
para siempre. El registro corta a 2 000 series por métrica y avisa en el log,
para que una etiqueta mal elegida se note como un aviso y no como una fuga.

---

## 13. Roadmap de implementación

Cada fase termina con: tests verdes, demo funcionando **sin API keys**, y documentación actualizada.

| Fase | Entregable | Criterio de aceptación |
|---|---|---|
| **F0 — Fundaciones** ✅ | Monorepo, TS estricto, ESLint + dependency-cruiser (reglas de capa), Docker compose (PG+pgvector), config Zod, logger, Result, errores, DI, EventBus + Outbox, TenantContext, Prisma base, CI. | ✅ `pnpm dev` levanta la API; `/health/ready` responde con Postgres `up` y los tres proveedores en `mock`. `pnpm verify` limpio: 0 violaciones de arquitectura, 29 tests. |
| **F1 — Núcleo conversacional** ✅ | Módulos `identity`, `channels` (adaptador `console` + SSE) y `conversation`. Contactos, identidades por canal, conversaciones, mensajes, memoria de slots, idempotencia de entrada, buffer de turno con candado por conversación. | ✅ `pnpm chat` conversa por terminal; tres mensajes seguidos se agrupan en un turno; el reintento de un webhook no duplica nada; el mismo teléfono escribiendo a dos inmobiliarias produce dos clientes aislados. 74 tests, 0 violaciones de arquitectura. |
| **F2 — Agente + MockLLM** ✅ | `LLMProvider` + suite de contrato, `MockLLMProvider`, ToolRegistry con validación Zod, ContextBuilder, PromptRegistry versionado, guardrails, bucle de tool calling con presupuesto, AgentRun persistido con su traza. | ✅ El agente saluda, extrae slots, llama herramientas reales, recuerda con procedencia y escala a un humano. **Cero API keys, coste 0,00 USD.** 155 tests. |
| **F3 — Catálogo** ✅ | Puerto `PropertyService` (seis capacidades) + suite de contrato + `MockPropertyService` con dataset semilla de 240 inmuebles. Tools de búsqueda, detalle, disponibilidad y fotos. Snapshots e impresiones. | ✅ De "hola" a cuatro fichas de inmueble con precio, área y barrio, renderizadas desde datos de la tool. 189 tests. |
| **F4 — Leads + Citas** ✅ | Módulos `leads` (captura idempotente, scoring con motivos, reparto por carga) y `appointments` (franjas en la zona horaria del tenant, calendario interno, reprogramación, recordatorios). Tools `register_lead`, `propose_visit_slots` y `schedule_visit`. | ✅ De "hola" a cita agendada sin intervención humana: el CRM se llena solo, la cita respeta el horario y la agenda ocupada, y el recordatorio sale por el canal del cliente. **El modelo no escribe ni una fecha.** 265 tests, 0 violaciones de arquitectura. |
| **F5 — Knowledge / RAG** ✅ | Colecciones, ingesta idempotente por huella, troceado consciente de la estructura, `EmbeddingProvider` + suite de contrato + `MockEmbeddingProvider` (hashing de bolsa de palabras, no ruido), pgvector con HNSW, full-text en español sin tildes, fusión RRF, `CitationGuardrail`. | ✅ "¿Aceptan mascotas?" se responde con el párrafo literal del reglamento y su fuente; "¿cuál es la tasa del euro?" NO se responde. **Cero API keys.** 325 tests, 0 violaciones de arquitectura. |
| **F6 — Canal WhatsApp** ✅ | Adaptador Cloud API: webhook firmado (HMAC sobre el cuerpo crudo), reparto del payload por número, mapeadores puros de entrada y salida, degradación de botones, credenciales cifradas por cuenta, acuses de entrega correlacionados. | ✅ Un webhook firmado entra por la API y recorre catálogo, agenda y conocimiento **sin tocar un solo caso de uso**; sin firma se rechaza con 403. Verificado contra un doble de la Graph API. Pendiente de una cuenta real: plantillas y media (§18.3). 381 tests. |
| **F7 — Back-office React** ✅ | Sesiones opacas con cookie `httpOnly` y guardia que fija el `TenantContext`, API del panel, aplicación React 19 + Vite, inbox en vivo (SSE) con toma de control humano, leads, agenda, base de conocimiento (subir, reindexar, borrar), configuración del agente y **simulador**. Contratos Zod compartidos entre API y web. | ✅ Un asesor opera todo el producto desde el navegador: lee lo que vio el cliente **en bloques**, toma el control, devuelve la conversación al agente, sube un documento y lo ve indexarse, cambia el tono y prueba el resultado en el simulador —que habla por la **misma ruta pública que un cliente**—. Sin token en `localStorage` y sin API keys. 414 tests, 0 violaciones de arquitectura. |
| **F8 — Providers reales** ✅ | Adaptadores de Anthropic (Messages API) y del formato Chat Completions —que sirve para OpenAI, Ollama y todo lo compatible—. Traducción en funciones puras y testeadas, coste estimado por turno, fallo al arrancar si falta una credencial. La suite de contrato corre contra los proveedores de verdad, y se salta sola cuando no hay clave. | ✅ `LLM_PROVIDER=anthropic` (u `openai`, u `ollama`) y **nada más cambia**: ni un caso de uso, ni una política, ni una herramienta. Sin `LLM_PROVIDER`, el producto sigue funcionando entero en modo demo sin ninguna clave. 436 tests, 0 violaciones de arquitectura. |
| **F9 — Producción** 🔶 | **Hecho:** control de coste por inmobiliaria (contador transaccional, tope mensual, degradación a persona, visible y editable en el panel). **RLS** con rol sin superusuario y políticas que fallan cerradas. **Límites de ritmo** en dos ámbitos —mensajes por inmobiliaria en la puerta de los canales, turnos por contacto en el agente— sobre un cubo de fichas puro. **Métricas** en `GET /metrics` (formato Prometheus) detrás de un puerto: tráfico, latencias, turnos por desenlace, coste y retraso del outbox, sin un solo identificador en las etiquetas. **Copias verificadas**: `db:backup` y `db:verify-restore`, que restaura en una base desechable y comprueba RLS forzado, políticas, permisos, extensiones, índices y filas. **SLOs, alertas y runbook** en `ops/prometheus/alerts.yml` y `docs/01-RUNBOOK.md`. **Evaluación automática de calidad** con juez determinista (§14 bis), en `pnpm test` contra el simulador y contra proveedores reales bajo demanda. **Pendiente:** exportador OTLP (necesita un colector con el que probarlo), copias programadas, paneles. | ✅ SLOs definidos y medidos; runbook de incidentes escrito, con cada alerta enlazada a su procedimiento y cada consulta SQL ejecutada contra la base real. |
| **F10 — Escala** | Canales adicionales, memoria semántica, A/B de prompts, colas Redis, réplicas de lectura. | Extraer un módulo a servicio propio sin reescribir lógica. |

### Orden de implementación consciente
Se construye el canal **console/web antes que WhatsApp** a propósito: obliga a que la lógica no dependa del canal y permite desarrollar y testear el 90 % del producto sin depender de Meta, números verificados ni plantillas aprobadas.

---

## 14. Estrategia de pruebas

| Nivel | Qué | Herramienta |
|---|---|---|
| Unit | Entidades, VOs, políticas (puras) | Vitest |
| Use case | Casos de uso con adaptadores in-memory | Vitest |
| **Contract** | **Una misma suite corre contra Mock y contra el adaptador real de cada puerto** (`LLMProvider`, `PropertyService`, `VectorStore`, `ChatChannel`) | Vitest |
| **Integración** | **Repositorios Prisma y rutas HTTP contra Postgres real y la aplicación entera montada** | **Vitest + Postgres del `docker compose`, base `…_test` (D41)** |
| E2E conversacional | Guiones: "cliente busca apto en Medellín" → aserciones sobre estado final (lead creado, cita agendada) | Vitest + canal `console` |
| **Calidad del agente** | **Conjunto dorado de conversaciones con juez determinista. Corre contra el simulador en cada `pnpm test`, y contra un modelo real con `pnpm eval --provider …`** | **`apps/api/eval/` (D70)** |

### 14 bis. Evaluación de calidad

El riesgo específico de un producto de IA no es que el código falle: es que
**empeore sin que nada falle**. Un prompt retocado, una versión nueva del modelo
o una herramienta modificada pueden degradar las respuestas mientras todos los
tests siguen en verde, porque los tests comprueban que el código hace lo que se
le pidió — no que el agente conteste bien.

```
pnpm test                          # incluye la evaluación contra el simulador
pnpm eval                          # el informe completo, con desglose por área
pnpm eval --tag seguridad          # solo un área, mientras se itera
pnpm eval --provider anthropic     # el mismo conjunto contra un modelo real
pnpm eval --update-baseline        # fija la referencia tras una mejora
```

**Dos clases de expectativa.** Las `critical` son defectos de producto —inventar
un precio, escribir una fecha, prometer en nombre de la inmobiliaria, revelar
datos de terceros— y una sola hace fallar la ejecución por muy alta que sea la
puntuación. Las `quality` son la nota. Con una sola cifra, un precio inventado
se compensaría con diez respuestas simpáticas.

**Qué mide cada modo.** Con el simulador mide el ARNÉS: prompts, herramientas,
políticas, guardrails, memoria y composición, que es la mayor parte del
producto — y lo hace sin claves, sin coste y de forma determinista, por eso está
dentro de `pnpm test`. El criterio del modelo solo se mide con un proveedor
real; el informe dice siempre contra cuál se corrió.

**La línea base** (`eval/baseline.json`) es lo que convierte un informe en una
suite de regresión: «87 %» no dice nada, «87 % cuando ayer era 96 %» lo dice
todo. Contra el simulador la tolerancia es cero.

### Dos suites, dos requisitos

```bash
pnpm test              # unitaria: sin infraestructura, funciona en un clon recién hecho
pnpm test:integration  # Postgres real: crea la base `…_test`, migra y ejecuta
pnpm verify:full       # typecheck + lint + arquitectura + las dos suites
```

Están separadas porque tienen coste y requisitos distintos, y mezclarlas
volvería lento el bucle de trabajo. **CI debe correr `verify:full`**: una
verificación que se salta la capa que habla con la base de datos da una
confianza que no ha ganado.

Lo que la integración cubre y lo unitario no puede:

- El `WHERE tenant_id = …` está de verdad en el SQL, no solo en un doble que
  escribimos nosotros. Un fallo aquí es una fuga entre clientes.
- `unaccent`, el lematizador español y las palabras vacías de Postgres:
  "comisión" y "comision" son la misma palabra, "requisitos" encuentra
  "requisito", y "del" no hace coincidir documentos ajenos.
- `FOR UPDATE SKIP LOCKED` y la reserva del outbox con varias réplicas.
- El HTTP real: los mismos plugins, el mismo guardia de sesión y el mismo
  manejador de errores que se despliegan, servidos con `inject()` en vez de por
  un socket.

Las tres primeras suites de integración escritas encontraron tres defectos
reales en código que llevaba fases dando por bueno: D42, D43 y un `findById`
sin ámbito de tenant. Ninguno era visible desde un doble en memoria.

---

## 15. Modo demo (requisito de producto)

Levantar el proyecto sin **ninguna** credencial:

```env
LLM_PROVIDER=mock
EMBEDDING_PROVIDER=mock
PROPERTY_PROVIDER=mock
CHANNEL_DEFAULT=console
```

- `MockLLMProvider`: determinista, basado en reglas + plantillas; **emite tool calls reales** según el estado de slots. No es un stub tonto: recorre el flujo completo (descubrimiento → búsqueda → presentación → lead → cita).
- `MockEmbeddingProvider`: embeddings pseudoaleatorios deterministas por hash → RAG funcional y reproducible sin coste.
- `MockPropertyService`: dataset semilla de ~120 inmuebles con filtros reales en memoria.
- `ConsoleChannel`: hablar con el agente desde la terminal.

Pasar a producción = cambiar variables de entorno. Ni un import distinto en el código de negocio.

---

## 16. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Alucinación de precios/inmuebles | Fichas renderizadas desde datos de tool + `GroundingValidator` + citas obligatorias en RAG. |
| Prompt injection (vía documentos o mensajes) | Tools reciben `tenantId` del contexto, nunca del LLM; contenido recuperado se marca como `untrusted`; tools de escritura con scopes. |
| Coste de tokens descontrolado | Presupuesto por turno y por tenant, `usage_counters`, ventana con recorte, caché de prompt. |
| Acoplamiento accidental a WhatsApp | Regla de lint: `whatsapp` solo puede aparecer bajo `channels/infrastructure/adapters/whatsapp/`. |
| Acoplamiento a un proveedor de catálogo | Regla de lint equivalente para adaptadores de `catalog`. |
| Fuga entre tenants | RLS + repositorio base + tests que intentan acceso cruzado explícitamente. |
| Duplicados por reintentos de webhook | Unicidad de `provider_message_id` + inbox de eventos. |
| Ráfagas y abuso: un bucle de integración o un número que insiste | Cubo de fichas en dos ámbitos (D58–D62): mensajes por inmobiliaria → 429 con `Retry-After`, así que el proveedor reintenta; turnos por contacto → el turno se omite y se avisa una vez. Complementa al tope de gasto, que acota el mes: esto acota el minuto. |

---

## 17. Decisiones tomadas

| # | Decisión | Estado | Fecha |
|---|---|---|---|
| D1 | **Monorepo pnpm** (`apps/api`, `apps/web`, `packages/contracts`) | ✅ Cerrada | 2026-08-04 |
| D2 | **Cola: pg-boss sobre Postgres**, detrás del puerto `JobQueue`. Migración a BullMQ+Redis cuando la carga lo exija. | ✅ Cerrada | 2026-08-04 |
| D3 | **v1 solo en español.** El `PromptRegistry` se diseña con clave `(key, version)`; el eje `locale` se añade en F10 sin romper el contrato. | ✅ Cerrada | 2026-08-04 |
| D4 | Despliegue: contenedor único API+worker; `worker.ts` como entrypoint separado desde F0 para poder escalar sin refactor. | ✅ Cerrada | 2026-08-04 |
| D5 | **Sin alias de rutas TypeScript.** Los imports dentro de un módulo son relativos: un módulo así es portable a otro repositorio sin reescribir un solo import, que es justo el objetivo de "preparado para microservicios". | ✅ Cerrada | 2026-08-05 |
| D6 | **Las extensiones de Postgres se crean en migraciones de Prisma**, no con scripts de `docker-entrypoint-initdb.d`. Los bind mounts dependen de qué unidades comparta Docker Desktop en cada máquina; una migración es reproducible en cualquier entorno, incluido producción. | ✅ Cerrada | 2026-08-05 |
| D7 | Puertos por defecto: API `3100`, Postgres `5433`, Mailpit `8025`. Evitan los choques habituales con otros proyectos en la misma máquina. | ✅ Cerrada | 2026-08-05 |
| D8 | **El cradle de DI se compone explícitamente**, no por *declaration merging*. Cada módulo declara su `XCradle` en su `index.ts` y tipa su registro contra `PlatformCradle & XCradle`; `bootstrap/container.ts` los suma en una línea por módulo. Ningún módulo importa el composition root, así que no hay ciclo, y qué hay en el contenedor se lee de un vistazo. | ✅ Cerrada | 2026-08-06 |
| D9 | **Los adaptadores de canal se componen en `modules/channels/index.ts`**, no en `bootstrap/`. La regla de lint de WhatsApp admite ese archivo además del composition root: es el punto de composición natural del módulo y evita que `bootstrap` tenga que conocer cada proveedor. | ✅ Cerrada | 2026-08-06 |
| D10 | **`TenantContext` se restablece en el bus de eventos**, a partir del sobre. Un handler nunca corre sin tenant, y ningún consumidor futuro tiene que acordarse de hacerlo. | ✅ Cerrada | 2026-08-06 |
| D11 | **La memoria (`conversation`) tiene su propio vocabulario de preferencias**, separado de `SearchCriteria` del catálogo (F3). Traducir de uno a otro será un mapper explícito: así el vocabulario de un proveedor externo no se cuela en lo que recordamos del cliente. | ✅ Cerrada | 2026-08-06 |
| D12 | **El agente responde por el puerto público de `conversation`, no emitiendo `agent.reply_ready`.** El §9.2 preveía ese evento; en la práctica la respuesta debe persistirse ANTES de entregarse (para que quede constancia aunque el proveedor falle), y eso ya lo hace `conversation.reply()`. Un evento adicional crearía un segundo camino hacia el mismo sitio. `agent.run_completed` y `agent.handoff_requested` sí se publican. | ✅ Cerrada | 2026-08-06 |
| D13 | **`AgentConfig` no tiene tabla todavía.** Se deriva de `TenantSettings` más los presupuestos del entorno. La tabla llega en F7, cuando exista una pantalla para editarla; hasta entonces sería una tabla que nadie escribe. **Revisada en F7 (D36): la pantalla se construyó y la tabla no hizo falta** — lo que un cliente configura resultó ser negocio del tenant. Contradice el §10.2, que la listaba en `identity`: cuando exista, irá en `agent`, que es quien conoce las herramientas y las versiones de prompt. | ✅ Cerrada | 2026-08-06 |
| D15 | **No hay adaptador HTTP de catálogo, y es una decisión.** No conocemos la API de ningún proveedor real; escribir uno "genérico" hoy significaría inventarse endpoints, autenticación y formatos de respuesta, que es exactamente lo que el principio 3 prohíbe. El puerto está definido y probado con una suite de contrato; el adaptador se escribe el día que haya un proveedor concreto. `PROPERTY_PROVIDER` distinto de `mock` falla al arrancar con un mensaje claro. | ✅ Cerrada | 2026-08-06 |
| D16 | **Las herramientas devuelven bloques de respuesta ya renderizados** (`ToolResult.blocks`). Es la forma ejecutable de la regla del §7.3 paso 5: las fichas de inmueble se construyen desde los datos del proveedor, y el modelo solo escribe la frase que las presenta. Un precio en una ficha no puede ser inventado porque el modelo no la escribe. | ✅ Cerrada | 2026-08-06 |
| D17 | **`catalog` tiene dos puertos, no uno.** `PropertyService` mira hacia fuera (lo implementa cada proveedor) y `CatalogService` hacia dentro (lo consume el agente). Separarlos permite que el lado interno añada snapshots y eventos sin ensuciar el contrato que tendrá que cumplir un tercero. | ✅ Cerrada | 2026-08-06 |
| D14 | **El escalamiento explícito no pasa por el modelo.** "Quiero hablar con una persona" lo resuelve una política determinista antes de la primera llamada al LLM: coste cero, latencia cero y sin depender de que el modelo lo capte. La herramienta `request_human_agent` sigue disponible para lo que las reglas no cubran; ambos caminos convergen en el mismo `HandoffCoordinator`. | ✅ Cerrada | 2026-08-06 |
| D18 | **`leads` tiene su propio vocabulario de requisitos**, distinto del de la memoria (D11) y del del catálogo. Es el tercer vocabulario y es deliberado: el perfil cambia mientras el cliente habla, el criterio de búsqueda muere con la consulta, y estos requisitos son la foto que un asesor abrirá dentro de tres semanas. Compartir el tipo haría que un cambio en la memoria conversacional reescribiera fichas ya cerradas. | ✅ Cerrada | 2026-08-06 |
| D19 | **La captura de leads NO depende del modelo.** Mostrar inmuebles crea la ficha por evento (`catalog.property_shown` → `leads`), y agendar la crea por puerto. `register_lead` existe para lo que el modelo sí puede aportar —consentimiento, interés explícito—, pero el CRM se llena aunque el modelo no llame a ninguna herramienta. Lo determinista sostiene el producto; el modelo solo lo hace conversacional. | ✅ Cerrada | 2026-08-06 |
| D20 | **El modelo no escribe fechas, igual que no escribe precios.** `propose_visit_slots` devuelve franjas con su etiqueta ya redactada y una referencia opaca; `schedule_visit` solo acepta esa referencia. La preferencia de día viaja en términos relativos (`tomorrow`, `next_week`), nunca como fecha. Un precio inventado incomoda; una hora inventada manda a un cliente a una oficina cerrada. | ✅ Cerrada | 2026-08-06 |
| D21 | **La proyección a texto de un mensaje vive en `channels` (`blocksToText`) e incluye lo que el cliente VIO**, no solo el texto redactado: opciones ofrecidas y títulos de fichas. Sin esto, el agente no entiende "la segunda" en el turno siguiente. Los precios de las fichas quedan fuera a propósito: el guardrail de grounding compara contra las herramientas de ESE turno, y un precio arrastrado del historial sería indistinguible de uno inventado. | ✅ Cerrada | 2026-08-06 |
| D22 | **Un bloque interactivo al que le sigue otro contenido se descarta antes de enviar** (`pruneAnsweredPrompts`). Un turno puede proponer horarios y agendar; enviar las dos cosas produciría "elige un horario" seguido de "tu visita quedó agendada". La regla es general y no menciona citas. | ✅ Cerrada | 2026-08-06 |
| D23 | **No hay tabla `advisor_availability` todavía.** La disponibilidad sale del horario del tenant menos las citas ya agendadas, a través del puerto `CalendarService` con un adaptador interno. Una agenda por asesor —o un calendario externo— implementará el mismo puerto cuando exista quien la mantenga; crear hoy una tabla que nadie escribe sería peor que no tenerla. Contradice el §10.2, que la listaba. | ✅ Cerrada | 2026-08-06 |

| D24 | **El troceado corta en cada epígrafe, quepa o no en el fragmento.** "Mascotas" y "Depósito" son temas distintos: un fragmento que los mezcla se recupera para las dos preguntas y responde bien a ninguna. Sin esta regla, un reglamento corto entero cabía en un solo fragmento y el buscador dejaba de discriminar — se detectó ejecutando, no revisando. En una frontera de sección no hay solape, porque emborronaría justo el límite que se acaba de marcar. | ✅ Cerrada | 2026-08-06 |
| D25 | **Cada fragmento guarda con qué modelo se vectorizó, y la búsqueda solo compara dentro del mismo espacio.** Comparar por coseno vectores de dos modelos no da un resultado malo: da uno sin significado y con aspecto de funcionar. Cambiar de proveedor de embeddings NO es transparente — obliga a reindexar, y por eso se guarda el original de cada documento. | ✅ Cerrada | 2026-08-06 |
| D26 | **La ingesta admite texto plano y Markdown; rechaza lo demás.** Un PDF leído como texto produce fragmentos de basura que se recuperan, se citan y acaban delante de un cliente. `TextExtractor` es un puerto para que PDF o HTML sean un adaptador más; hasta entonces se dice que no. `URL` queda igualmente fuera: bajar una página y convertirla en texto útil es un problema propio. | ✅ Cerrada | 2026-08-06 |
| D27 | **`FileStorage` con adaptador local; S3 cuando haya despliegue.** Cierra la decisión abierta §18.2. Se guarda el original de cada documento porque sin él, reindexar exigiría pedirle al cliente que vuelva a subir sus documentos. El adaptador S3 no se escribe hoy por el mismo motivo que no hay adaptador HTTP de catálogo (D15): sería código que nadie ha ejecutado. | ✅ Cerrada | 2026-08-06 |
| D28 | **El carril léxico une los términos con OR, no con AND.** `plainto_tsquery` los une con AND y en una pregunta real eso no encuentra nada: "¿qué documentos necesito?" exigiría que el párrafo contuviera además "necesito". Se pasa el texto por `to_tsvector` —que normaliza, lematiza y descarta palabras vacías— y se unen los lexemas con `\|`; ordena `ts_rank`. De paso, al `to_tsquery` solo llegan lexemas ya normalizados por Postgres, nunca texto del usuario. | ✅ Cerrada | 2026-08-06 |
| D29 | **El suelo de relevancia se aplica a cada fragmento, no solo para decidir si hay respuesta.** El carril vectorial siempre devuelve sus vecinos más próximos aunque estén lejísimos; si entran en la fusión, acaban en las citas y el agente cita el reglamento de convivencia al hablar de escrituración. Los del carril léxico no necesitan suelo: contienen los términos. | ✅ Cerrada | 2026-08-06 |

| D30 | **`normalizeInbound` devuelve una LISTA y el payload se reparte por número antes de resolver la cuenta.** Los webhooks entregan en lote: una llamada de Meta puede traer mensajes de dos inmobiliarias distintas. Pasar el payload entero a la primera cuenta resuelta le habría entregado también los mensajes de la segunda — una fuga entre clientes por descuido de estructura, no de permisos. | ✅ Cerrada | 2026-08-06 |
| D31 | **WhatsApp solo se registra si la app de Meta está configurada.** Sin `WHATSAPP_APP_SECRET` y `WHATSAPP_VERIFY_TOKEN` el canal no existe y el webhook no se monta: un canal registrado sin credenciales aceptaría webhooks que no puede verificar. El modo demo por consola sigue funcionando sin configurar nada. El App Secret es de la *app* (una para toda la plataforma); el token de acceso es de cada número y vive cifrado en su cuenta. | ✅ Cerrada | 2026-08-06 |
| D32 | **La ventana de 24 horas no se adivina: se maneja el rechazo de Meta.** Llevar nuestro propio registro del último mensaje de cada cliente añade un estado que, si se desincroniza, deja de responder EN SILENCIO. Meta rechaza con el código 131047 y el cliente lo traduce a un mensaje legible. Enviar plantillas exige plantillas aprobadas, que no se pueden probar sin cuenta real (§18.3). | ✅ Cerrada | 2026-08-06 |
| D33 | **`document_chunks.tsv` deja de ser columna generada.** Prisma no sabe modelarlas y bloqueaba toda migración posterior con un `ALTER` que Postgres rechaza. El vector lo sigue calculando Postgres, ahora en el `INSERT` del repositorio —que ya era SQL crudo por pgvector—, así que se conserva la garantía que importaba: un solo sitio decide cómo se indexa el texto. Una herramienta que impide migrar es peor que una comodidad. | ✅ Cerrada | 2026-08-06 |
| D34 | **Sesiones opacas en servidor con cookie `httpOnly`, no JWT.** Cierra la decisión abierta §18.1. Un JWT no se puede revocar: dar de baja a un asesor dejaría su token válido hasta que caduque, y en un producto multi-inmobiliaria eso es una puerta abierta con fecha. El token es un valor aleatorio del que solo se guarda el hash; validarlo es un `SELECT` que además prorroga la sesión si hay actividad. En producción la cookie lleva prefijo `__Host-`. | ✅ Cerrada | 2026-08-07 |
| D35 | **El guardia de sesión es de estilo callback, no `async`.** `AsyncLocalStorage.enterWith()` desde un hook asíncrono de Fastify no llega al handler: cuando la promesa se resuelve, la cadena continúa en un contexto capturado antes de que el hook corriera. Envolviendo `done()` en `TenantContext.run()`, el resto del ciclo de vida de la petición ocurre dentro del ámbito. Se descubrió con un `TENANT_CONTEXT_MISSING` en la primera petición real, no revisando código. | ✅ Cerrada | 2026-08-07 |
| D36 | **La configuración del agente NO tiene tabla propia: es `TenantSettings`.** Revisa D13, que anunciaba una tabla `AgentConfig` para F7. Al construir la pantalla, todo lo que un cliente quiere configurar —nombre, tono, bienvenida, horario, cuándo escalar— resultó ser negocio del tenant y no del agente: no menciona modelo, ni herramientas, ni versión de prompt, y por eso sobrevive a cambiar de proveedor. Una tabla nueva habría duplicado lo que ya existe sin guardar nada nuevo. | ✅ Cerrada | 2026-08-07 |
| D37 | **Lo que depende del proveedor se muestra pero no se edita.** El modelo de lenguaje y el de embeddings se eligen al desplegar, por variable de entorno. Un selector en la pantalla permitiría cambiar el de embeddings sin reindexar, y la búsqueda pasaría a comparar vectores de dos espacios distintos (D25): no daría peores resultados, daría resultados sin sentido con aspecto de funcionar. La pantalla informa; el despliegue decide. | ✅ Cerrada | 2026-08-07 |
| D38 | **Los canales viajan en su propia respuesta, no dentro de `/api/settings`.** Son del módulo `channels`, que ya depende de `identity`; meterlos en la respuesta de configuración obligaría a `identity` a conocer `channels` y cerraría un ciclo entre módulos. Dos peticiones desde el navegador son gratis; un ciclo en el grafo es el primer paso para que un monolito modular deje de serlo. La proyección además excluye `config`, donde viven las credenciales cifradas: reutilizar la vista que reciben los adaptadores habría sacado secretos del servidor por ahorrar un tipo. | ✅ Cerrada | 2026-08-07 |
| D39 | **El simulador habla por la ruta pública del canal, no por una interna.** El navegador pregunta cuál es la cuenta de consola de su inmobiliaria y después le escribe por la misma URL que usaría un cliente final: mismo caso de uso, mismo agente, misma conversación persistida, que aparece en el inbox como cualquier otra. Un simulador con su propio atajo probaría un camino que nadie usa y fallaría justo el día que hace falta. "Empezar de nuevo" no borra nada: genera un remitente nuevo. | ✅ Cerrada | 2026-08-07 |
| D40 | **El número de documentos de una colección se cuenta, no se guarda.** El campo `documentCount` existía desde F5 y valía cero siempre; la pantalla lo destapó mostrando "Políticas (0)" con tres documentos dentro. Se elimina del dominio y se calcula con un `GROUP BY` en la lectura. Un contador denormalizado se desincroniza en cuanto un borrado falla a medias, y el síntoma —"(7)" con cuatro documentos— hace dudar de todo lo demás que muestra la pantalla. | ✅ Cerrada | 2026-08-07 |
| D41 | **La suite de integración usa el Postgres del `docker compose`, en una base aparte, no Testcontainers.** Lo que hace falta probar —HNSW, `ts_rank`, `unaccent`, `SKIP LOCKED`— es exactamente lo que ningún doble imita, y el proyecto ya levanta ese Postgres. Un contenedor propio por ejecución añadiría medio minuto de arranque para obtener la misma base. Se usa `…_test` y las MIGRACIONES reales, no `db push`: un esquema empujado desde el modelo se parece al de producción pero no es el mismo. `pnpm test` sigue sin necesitar infraestructura; `pnpm verify:full` la exige. | ✅ Cerrada | 2026-08-07 |
| D42 | **`reserveBatch` empuja `available_at` hacia adelante; `SKIP LOCKED` no bastaba.** El bloqueo de `FOR UPDATE SKIP LOCKED` muere con la sentencia, y el relay tarda mucho más: reserva un lote y entrega los eventos uno a uno ejecutando manejadores. Una segunda réplica que sondeara durante ese rato se llevaba el MISMO lote. No llegaba a ejecutarse un manejador dos veces —la idempotencia del bus lo impedía— pero el trabajo se duplicaba y la promesa de "varias réplicas sin duplicar entregas" era falsa. Ahora la reserva incluye un plazo de invisibilidad de 60 s: si el worker muere, los eventos vuelven pasado el plazo. Es un aplazamiento, nunca una pérdida. | ✅ Cerrada | 2026-08-07 |
| D43 | **El epígrafe se despega del principio del bloque, no se busca en el bloque entero.** En Markdown escrito por personas el título va pegado a su párrafo, sin línea en blanco: las dos líneas son un solo bloque y `^#…$` no casaba nunca. El epígrafe se perdía y la sección no abría fragmento, así que un reglamento entero acababa en un trozo sin contexto — lo contrario de lo que D24 exige. Sobrevivió a F5 porque los documentos del seed sí dejan la línea en blanco; lo destapó el primer test contra Postgres. **Los documentos indexados antes de este arreglo hay que reindexarlos.** | ✅ Cerrada | 2026-08-07 |
| D44 | **El adaptador de Anthropic NO envía `temperature`.** Los modelos actuales de Anthropic la rechazan con un 400; el puerto la exige porque otros proveedores sí la aceptan. Descartarla en el adaptador es exactamente lo que el puerto dice que debe hacerse con lo que un proveedor no soporta — y es la prueba de que la abstracción aguanta un proveedor que no encaja en el mínimo común denominador, en vez de tener que rehacerse. El comportamiento se controla con `effort` y con el prompt. | ✅ Cerrada | 2026-08-07 |
| D45 | **Un solo adaptador para OpenAI, Ollama y todo lo compatible.** El formato Chat Completions se convirtió en el estándar de facto: Ollama, Groq, Together y vLLM lo hablan. El adaptador recibe `baseUrl` e `id` en vez de dar por hecho que al otro lado está OpenAI, así que un servicio compatible más es una línea de configuración y no una clase nueva. Anthropic sí necesita el suyo: su formato de mensajes es genuinamente distinto (el sistema no es un mensaje, los resultados de herramienta los manda el usuario). | ✅ Cerrada | 2026-08-07 |
| D46 | **Con razonamiento activo se sube el suelo de `max_tokens`; no se apaga el razonamiento.** En los modelos actuales el razonamiento consume del mismo presupuesto que la respuesta, así que un turno que pide 500 tokens se quedaría sin sitio para contestar. Apagarlo tiene un fallo mucho peor: el modelo escribe entonces la llamada a la herramienta **como texto**, el turno termina sin error y la herramienta no se ejecuta nunca — una cita que nadie agenda y nada lo señala. Subir el techo no cuesta: se factura lo generado, no lo permitido. | ✅ Cerrada | 2026-08-07 |
| D47 | **Sin precio conocido, el coste es 0 y se avisa; nunca se estima a ojo.** Los precios de Anthropic y el coste nulo de Ollama están en una tabla; los de OpenAI no, porque cambian a menudo y no se pueden verificar desde el repositorio. Un número inventado produciría informes de coste plausibles y falsos, que es peor que no tener informe: el segundo se nota, el primero se cree. | ✅ Cerrada | 2026-08-07 |
| D48 | **La suite de contrato contra proveedores reales se salta sola si no hay credencial.** Cada ejecución cuesta dinero y depende de un servicio ajeno. Quien clona el repositorio no debe ver tests rojos por no tener una clave de pago, y CI no debe gastar en cada commit. Un fallo ahí, aunque sea intermitente, es información valiosa: significa que ese proveedor no cumple lo que el orquestador da por supuesto. | ✅ Cerrada | 2026-08-07 |
| D49 | **El gasto se lleva en un CONTADOR, no en una suma sobre `agent_runs`.** Sumar el coste de todas las ejecuciones del mes en cada turno funciona el primer mes y se degrada sin avisar: la tabla crece con cada turno de cada inmobiliaria, y la comprobación que debía proteger la factura acaba siendo lo más lento de la petición. El contador se incrementa **en la base** con `ON CONFLICT … DO UPDATE SET x = tabla.x + excluido.x`: un leer-modificar-escribir desde Node pierde incrementos con dos réplicas del worker, y un contador que pierde incrementos reporta menos gasto del real. | ✅ Cerrada | 2026-08-07 |
| D50 | **Un tope de cero significa SIN tope, no "no gastes nada".** Es la lectura que evita el peor accidente posible: a una inmobiliaria que olvidó configurar el límite se le apagaría el agente de golpe, y el fallo parecería del producto. Quien quiere apagar el agente lo apaga; no le pone un presupuesto de cero. | ✅ Cerrada | 2026-08-07 |
| D51 | **Agotar el tope escala a una persona; nunca deja al cliente sin respuesta.** Un agente que se queda mudo porque su inmobiliaria se pasó del presupuesto parece un producto roto; uno que dice "te paso con un asesor" parece un producto. La comprobación va antes de llamar al modelo —el único momento en que sirve— y el gasto se anota en un `finally`, porque un turno que llamó al modelo y luego escaló o reventó ya se pagó: anotar solo el camino feliz dejaría fuera justo los turnos que se repiten cuando algo va mal. | ✅ Cerrada | 2026-08-07 |
| D52 | **El corte del mes cae en la medianoche de la inmobiliaria, no en la de UTC.** En UTC, una inmobiliaria de Bogotá vería su presupuesto reiniciarse a las siete de la tarde del último día del mes, en mitad de la jornada y con los turnos partidos entre dos periodos. | ✅ Cerrada | 2026-08-07 |
| D53 | **Guardar la configuración invalida la caché del directorio de tenants.** El `invalidate()` existía desde F1 con un comentario que decía "lo invoca `identity` tras cambiar un tenant" — y nadie lo llamaba. Cambiar el tono o el tope desde el panel no surtía efecto hasta 30 segundos después, y para un tope de gasto eso significa que bajarlo no aplica cuando hace falta. Lo destapó F9; el fallo estaba desde que existe la pantalla. | ✅ Cerrada | 2026-08-07 |
| D54 | **Row Level Security, la tercera capa de aislamiento.** Las dos primeras —`TenantContext` y `tenantScope()` en cada repositorio— dependen de que el código no se olvide, y ya se demostró que puede: un `findById` sin ámbito sobrevivió seis fases. Las políticas comparan `tenant_id` con `current_setting('app.tenant_id')` y **fallan cerradas**: sin ajuste no se ve ni una fila, así que un olvido produce cero resultados en vez de datos ajenos. La lista de tablas protegidas vive en TypeScript y un test la compara con lo que hay en Postgres, así que una tabla nueva con `tenant_id` sin proteger rompe el build. | ✅ Cerrada | 2026-08-07 |
| D55 | **La aplicación se conecta con un rol SIN superusuario, y sin eso RLS no protege nada.** Un superusuario se salta todas las políticas incluso con `FORCE ROW LEVEL SECURITY`, y el usuario que crea `docker compose` lo es. Con las políticas activas y el rol equivocado, todo *parece* correcto: existen, se ven en `pg_class`, y no hacen absolutamente nada. Lo destapó un test que insertaba filas de dos inmobiliarias y contaba sin filtrar: salían las tres. `pnpm db:provision` crea el rol y **reafirma sus atributos en cada migración**, por si alguien puso un `BYPASSRLS` para depurar y se olvidó de quitarlo. | ✅ Cerrada | 2026-08-07 |
| D56 | **`SET LOCAL` dentro de una transacción, nunca a nivel de sesión.** Con un pool, un ajuste de sesión se queda pegado a la conexión y la siguiente petición que la reutilice hereda el tenant de la anterior — un fallo PEOR que no tener RLS, porque devuelve datos ajenos en vez de ninguno. Las lecturas sueltas se envuelven en una transacción de dos sentencias, lo que **cuesta un viaje de ida y vuelta extra por consulta**. Es un precio consciente: la alternativa es que el aislamiento dependa de que ningún repositorio se olvide nunca. | ✅ Cerrada | 2026-08-07 |
| D57 | **Cruzar la frontera entre inmobiliarias es posible, pero hay que escribirlo.** El seed y el mantenimiento usan `runAcrossTenants()`, que fija el comodín y deja rastro en el log. Que sea explícito y buscable es la propiedad que se quiere: nadie cruza por accidente, y `grep` encuentra en un segundo cada sitio que lo hace. | ✅ Cerrada | 2026-08-07 |
| D58 | **El límite de ritmo se cuenta EN MEMORIA, a diferencia del gasto.** Con N réplicas el límite efectivo es N veces el configurado, y eso sería inaceptable para el tope de gasto —donde el número tiene que cuadrar con una factura, y por eso vive en una sentencia atómica de Postgres. Aquí sí lo es, por tres razones: lo que se protege es el orden de magnitud (cortar a 120 o a 360 da igual; cortar o no cortar, no); el límite se comprueba en el camino más caliente que existe —cada mensaje entrante— y llevarlo a la base convertiría cada mensaje en una escritura extra, de modo que el mecanismo que debía protegerla sería la carga que la tumba; y un contador en memoria sigue funcionando cuando la base está ahogada, que es justo cuando hace falta. El reemplazo por Redis es un adaptador detrás del mismo puerto: el algoritmo ya es una función pura. | ✅ Cerrada | 2026-08-08 |
| D59 | **Cubo de fichas, no ventana fija.** Una ventana fija de "200 por minuto" deja pasar 400 en dos segundos si caen a caballo del cambio de minuto: el peor caso es el doble del límite que creías haber puesto. Un registro deslizante no tiene ese defecto pero guarda una marca de tiempo por petición. El cubo cuesta dos números por clave y describe el tráfico real mejor que ninguno: una ráfaga tolerada y un ritmo sostenido que se repone. Un proveedor entrega un lote y luego gotea; un bucle martillea. El primero pasa, el segundo se corta. | ✅ Cerrada | 2026-08-08 |
| D60 | **El límite de entrada NO puede vivir en el servidor HTTP.** El límite global de Fastify cuenta por IP, y por la IP de Meta entran los mensajes de TODAS las inmobiliarias: cortar ahí castigaría a las demás por el bucle de una. El tenant solo se conoce después de resolver la cuenta de canal, así que la comprobación va en `ReceiveInboundMessage`. Y **el lote cuesta lo que trae**: si un webhook con cincuenta mensajes contara igual que uno con uno, agrupar sería la forma trivial de saltárselo, y los proveedores agrupan de serie. Un lote mayor que el cubo se recorta al cubo en vez de ser impagable — si no, el proveedor reintentaría para siempre y ninguno de sus mensajes entraría jamás. | ✅ Cerrada | 2026-08-08 |
| D61 | **Superar el límite de entrada devuelve 429 con `Retry-After`; superar el de turnos omite el turno y avisa una sola vez.** Son dos degradaciones distintas porque son dos problemas distintos. En la entrada, el 429 hace que el proveedor reintente: la conversación se aplaza, no se rompe. En el turno, los mensajes del cliente YA están guardados y la conversación sigue abierta, así que dejar de generar no pierde nada; escalar a una persona —como sí hace el tope de gasto, donde el problema es de la inmobiliaria— convertiría el abuso de un solo número en una forma de inundar el buzón del equipo. El aviso sale de su propio cubo de una ficha cada diez minutos: repetirlo en cada mensaje bloqueado sería duplicar la inundación por el otro lado, y en WhatsApp además pagar por hacerlo. | ✅ Cerrada | 2026-08-08 |
| D62 | **Si el limitador falla, se deja pasar.** Misma regla que el contador de gasto: no poder medir el ritmo es un problema nuestro, y convertirlo en clientes sin respuesta sería un problema mucho mayor. Una protección no puede ser más dañina que aquello de lo que protege. | ✅ Cerrada | 2026-08-08 |
| D63 | **Métricas primero, trazas después — y el hueco real no eran las trazas.** El roadmap decía "OpenTelemetry", pero el detalle de un turno YA está persistido: `agent_runs` y `agent_run_steps` guardan cada paso con su duración, su modelo y su coste, que para este producto es mejor que un span genérico. Lo que no existía era lo operativo: tasas, latencias, ratio de error, saturación. Y un exportador OTLP que no se puede verificar contra ningún colector sería la trampa de D55 otra vez — parece correcto y no hace nada. Se construye un registro propio (treinta líneas de formato bien especificado) detrás de un puerto `Metrics`, y el exportador OTLP entra como adaptador el día que haya colector con el que probarlo. | ✅ Cerrada | 2026-08-08 |
| D64 | **Ninguna etiqueta de métrica lleva un identificador.** Ni `tenantId`, ni `conversationId`, ni `contactId`, ni `correlationId`, ni la URL con el id dentro —se etiqueta con el PATRÓN de ruta— ni el mensaje de un error —se etiqueta con su código—. Cada combinación distinta de etiquetas es una serie temporal que el sistema de monitorización guarda para siempre: con cientos de inmobiliarias, etiquetar por tenant convierte un panel en una factura. El detalle por inmobiliaria vive donde debe: exacto y transaccional en `tenant_usage_periods`, y en los logs, que sí llevan `tenantId`. **Las métricas responden "cuánto y cómo de rápido"; los logs responden "a quién".** El registro corta a 2 000 series por métrica y avisa, para que una etiqueta mal elegida salga en el log en vez de crecer toda la noche. | ✅ Cerrada | 2026-08-08 |
| D65 | **Un solo catálogo de métricas, no una por módulo.** `app-metrics.ts` se lee como la respuesta a "¿qué vigilamos?". Cuando cada sitio declara las suyas, en seis meses hay tres formas de contar lo mismo con tres nombres parecidos y ningún panel que sume bien. Y se instrumenta en los puntos de paso obligados —un hook de Fastify, un decorador del proveedor, el `finish` del registro de herramientas, una envoltura del turno— nunca en cada `return`: así el camino que alguien añada mañana ya está medido. | ✅ Cerrada | 2026-08-08 |
| D66 | **`GET /metrics` falla cerrado en producción.** El endpoint publica la versión desplegada, el gasto acumulado y el mapa de rutas: es reconocimiento gratis. Sin `METRICS_TOKEN` en producción la ruta NO se registra y el arranque lo avisa; con token, quien no lo trae recibe **404 y no 401**, porque un 401 confirma que el endpoint existe. En desarrollo está abierta, que es lo que hace útil un `curl`. | ✅ Cerrada | 2026-08-08 |
| D67 | **Los índices que Prisma no sabe modelar se declaran en TypeScript y los guarda un test.** `prisma migrate dev` trata como deriva todo lo que su lenguaje de esquema no expresa: al generar la migración de F7 tiró el HNSW de pgvector y el GIN del full-text, creados con SQL crudo en F5. **Sobrevivió tres fases porque no rompe nada** — los resultados seguían siendo correctos, solo que recorriendo la tabla entera; un test de resultados no podía verlo. Ahora: el GIN está declarado en el modelo (Prisma ya no lo toca), `db:migrate` y `db:deploy` terminan ejecutando `db:indexes` —idempotente— y un test de integración compara `prisma/indexes/search-indexes.ts` con `pg_am`, incluyendo un barrido que falla si aparece cualquier índice no-btree sin declarar. Lo destapó `db:verify-restore` en su primera ejecución. | ✅ Cerrada | 2026-08-08 |
| D68 | **El aprovisionamiento reasigna la propiedad de las tablas al rol de la aplicación.** Las migraciones corren con ese rol y en PostgreSQL solo el DUEÑO puede alterar una tabla: en una base creada antes de separar los roles (D55), las tablas son del administrador y la siguiente migración muere con «must be owner of table». Le pasó a la base de desarrollo de este repositorio. Reasignar no abre ningún agujero, y ese es exactamente el motivo por el que las políticas se declararon con **FORCE**: sin él, el dueño se salta su propia RLS. | ✅ Cerrada | 2026-08-08 |
| D69 | **Una copia se da por buena cuando se ha restaurado y comprobado, no cuando existe el fichero.** `db:verify-restore` la restaura en una base desechable y verifica lo que este sistema necesita para seguir siendo correcto: RLS activo **y forzado**, políticas presentes, permisos del rol, extensiones, el índice HNSW, el recuento de filas y la migración a la que corresponde. Cada punto está porque su ausencia falla **en silencio** — el caso peor es un volcado hecho con el rol de la aplicación, que con RLS forzado sale con el esquema entero y cero filas, y tiene exactamente el mismo aspecto que uno bueno. | ✅ Cerrada | 2026-08-08 |

| D70 | **La calidad del agente se evalúa con un juez DETERMINISTA, no con otro modelo.** «Que un LLM puntúe la respuesta» exige una clave —lo que este producto se niega a requerir—, cuesta dinero en cada ejecución y da un número distinto cada vez, así que no sirve como suite de regresión. Todas las comprobaciones son código: expresiones regulares, herramientas invocadas, estado del CRM y de la agenda. Y **dos clases de expectativa, no una nota media**: un fallo `critical` —inventar un precio, escribir una fecha, prometer en nombre de la inmobiliaria— hace fallar la ejecución por muy alta que sea la puntuación. Con una sola nota, un precio inventado se compensaría con diez respuestas simpáticas. Corre en `pnpm test` contra el simulador (sin claves, sin coste) y con `pnpm eval --provider anthropic` contra un modelo real: lo primero mide el ARNÉS —prompts, herramientas, políticas, guardrails, memoria—, lo segundo el criterio del modelo. La suite encontró en su primera ejecución que una pregunta con una palabra de preferencia dentro («¿qué requisitos piden para **arrendar**?») se tragaba la pregunta y solo guardaba la preferencia. | ✅ Cerrada | 2026-08-08 |
| D71 | **El doble de eventos de los tests ENTREGA, no solo apunta.** `RecordingEventPublisher` únicamente registraba, así que la cadena «el catálogo muestra inmuebles → el CRM se llena solo» —una de las promesas centrales del producto— nunca se ejecutaba en ningún test, y la evaluación reportaba un CRM vacío. `DispatchingEventPublisher` invoca las suscripciones reales del módulo, que ahora los dobles exponen. La entrega es sincrónica a diferencia de producción: es una simplificación consciente y en la dirección segura, porque aquí se comprueba QUÉ pasa y no CUÁNDO — lo asíncrono (reserva, reintentos, dead-letter) tiene su propia suite contra Postgres. | ✅ Cerrada | 2026-08-08 |

## 18. Decisiones abiertas

1. ~~Auth del back-office: sesión propia con cookies httpOnly vs proveedor externo~~ → **cerrada en F7 (D34)**: sesión opaca en servidor, cookie `httpOnly`, revocable al instante.
4. **Exportador OTLP.** El puerto `Metrics` ya existe y el registro Prometheus va detrás de él, así que el exportador es un adaptador más en el composition root — pueden convivir los dos. No se escribe todavía por la misma razón que las plantillas de WhatsApp: no hay colector contra el que probarlo, y código de observabilidad sin verificar es la peor clase de código de observabilidad (D63). Se cierra cuando haya un colector en el `docker compose` o en un despliegue.
3. **Plantillas y media de WhatsApp.** Ambas exigen una cuenta real: las plantillas hay que darlas de alta y que Meta las apruebe, y la media exige una segunda llamada a la Graph API para convertir un `id` en URL temporal. El adaptador las rechaza de forma explícita en vez de fingir que funcionan. Se cierran cuando haya un número verificado.
2. ~~Almacenamiento de archivos para `knowledge` y media~~ → **cerrada en F5 (D27)**: puerto `FileStorage` con adaptador local; S3-compatible cuando exista despliegue.

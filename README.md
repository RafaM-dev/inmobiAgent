# AgentInmobi

Agente de IA para inmobiliarias: atiende clientes, busca inmuebles, resuelve dudas con la
documentación de la empresa, registra leads y agenda visitas — por WhatsApp hoy y por
cualquier otro canal mañana.

La arquitectura completa está en **[`docs/00-ARCHITECTURE.md`](docs/00-ARCHITECTURE.md)**.
Ese documento manda: si el código y el documento discrepan, uno de los dos es un bug.

---

## Puesta en marcha (modo demo, sin ninguna API key)

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:migrate
pnpm db:seed        # inmobiliaria de demostración + sala de consola
pnpm dev            # API en :3100 y back-office en :5173
```

El panel de la inmobiliaria queda en **<http://127.0.0.1:5173>**:

```
inmobiliaria   inmobiliaria-demo
correo         asesor@inmobiliaria-demo.co
contraseña     demo-inmobiliaria-2026
```

Y ya se puede conversar con el producto como si fueras un cliente, en otra terminal:

```bash
pnpm chat
```

```
> hola
🤖 ¡Hola! Soy Sofía, de Inmobiliaria Demo. ¿Estás buscando para comprar o para
   arrendar? ¿En qué ciudad la estás buscando?

> busco apartamento en arriendo en Medellín
🤖 ¡Perfecto, ya lo anoté! ¿Qué presupuesto tienes en mente?

> hasta 2 millones, 2 habitaciones
🤖 Encontré 4 opciones que encajan con lo que buscas:
   1. Apartamento en La América, Medellín
      $800.000/mes | Habitaciones: 2 · Baños: 2 · Área: 56 m²
   2. Apartamento en Estadio, Medellín
      $1.150.000/mes | Habitaciones: 2 · Baños: 1 · Área: 65 m²
   …
   ¿Alguna te llama la atención?

> me gustaría visitar el segundo
🤖 Estos son los horarios que tengo disponibles:
   ¿Cuál de estos horarios te queda mejor?
   1. viernes, 7 de agosto, 9:00 a. m.
   2. viernes, 7 de agosto, 10:00 a. m.
   3. viernes, 7 de agosto, 12:00 p. m.

> la segunda
🤖 ¡Perfecto! Un asesor te acompañará en la visita.
   Tu visita quedó agendada: viernes, 7 de agosto, 10:00 a. m.

> ¿aceptan mascotas?
🤖 Se permiten mascotas de hasta quince kilos en las unidades residenciales,
   previa autorización escrita de la administración. No se admiten razas
   clasificadas como potencialmente peligrosas.
   Fuente: Reglamento de convivencia

> ¿cuál es la tasa de cambio del euro hoy?
🤖 Prefiero no darte un dato que no tenga confirmado. Déjame verificarlo con un
   asesor y te cuento.

> prefiero hablar con una persona
🤖 Claro, te comunico con un asesor. En un momento te escriben por aquí mismo.
```

**Sin ninguna API key y con coste 0,00 USD.** El agente entendió el español, guardó lo que
el cliente dijo, buscó en el catálogo cuando tuvo lo necesario, agendó la visita y, al
pedir una persona, silenció al bot sin consultar al modelo.

Por el camino, sin que nadie se lo pidiera: creó la ficha del cliente en el CRM, la
puntuó, se la asignó a un asesor y programó el recordatorio de la visita.

Los precios, las áreas y **las horas** de ese diálogo no los escribió el modelo: los
renderizan las herramientas desde datos reales. Es imposible que invente un precio, y
también que mande a alguien a una oficina cerrada un jueves que no era.

Si escribes tres mensajes seguidos, se agrupan en **un solo turno**: el mismo buffer que
evita responder tres veces a un cliente de WhatsApp.

Comprobación del estado:

```bash
curl http://127.0.0.1:3100/health/ready
```

No hace falta ninguna credencial de OpenAI, Anthropic, WhatsApp ni de ningún proveedor de
inmuebles. Los adaptadores por defecto son simulados y recorren el flujo completo. Para
pasar a un proveedor real solo cambia una variable:

```env
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

O `openai` (con `OPENAI_MODEL`), o `ollama` para un modelo en tu propia
máquina, que no necesita ninguna clave. Los tres pasan la **misma suite de
contrato** que ya pasa el simulador: eso es lo que hace que cambiar de
proveedor sea cambiar una variable y no reescribir el agente.

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | API + worker + back-office, con recarga |
| `pnpm dev:api` / `dev:web` | Solo uno de los dos |
| `pnpm chat` | Cliente de chat por terminal (canal `console`) |
| `pnpm verify` | typecheck + lint + reglas de arquitectura + tests unitarios |
| `pnpm verify:full` | Lo anterior **más los tests de integración**. Es lo que debe correr CI |
| `pnpm arch:check` | Verifica las fronteras entre capas y módulos |
| `pnpm test` | Tests unitarios. No necesita infraestructura |
| `pnpm test:integration` | Postgres real: crea la base `…_test`, migra y ejecuta |
| `pnpm infra:up` / `infra:down` | Postgres (pgvector) y Mailpit |
| `pnpm db:provision` | Crea el rol sin superusuario de la aplicación y sus permisos |
| `pnpm db:migrate` | Provisiona el rol y aplica las migraciones |
| `pnpm db:seed` | Inmobiliaria de demostración, su canal y su documentación |

El seed acepta parámetros, útil para comprobar el aislamiento entre inmobiliarias:

```bash
pnpm db:seed --slug otra-inmobiliaria --name "Otra" --account otra
pnpm chat --account otra
```

Puertos: API `3100`, Postgres `5433`, Mailpit UI `8025`.

## Estructura

```
apps/api        Backend (monolito modular, Clean Architecture)
apps/web        Back-office React (Vite; hace de proxy de /api hacia la API)
packages/contracts   Schemas Zod compartidos API ⇄ Web
docs/           Arquitectura y decisiones
```

## Reglas que el CI hace cumplir

`pnpm arch:check` falla el build si alguien:

- hace que el dominio dependa de infraestructura o de un framework;
- importa las tripas de otro módulo en lugar de su `index.ts`;
- menciona WhatsApp fuera de su adaptador;
- menciona un proveedor de inmuebles fuera de su adaptador;
- usa un SDK de IA fuera de `agent/infrastructure/llm`;
- importa Prisma fuera de `infrastructure/persistence`;
- introduce una dependencia circular;
- añade una tabla con `tenant_id` sin protegerla con RLS ni justificar la excepción.

No son convenciones de equipo: son reglas ejecutables.

## Qué se prueba, y contra qué

500 tests unitarios con dobles en memoria, y 59 de integración contra Postgres
de verdad y la aplicación entera montada. La separación importa: `pnpm test`
funciona en un clon recién hecho, `pnpm test:integration` exige la base
levantada.

Los de integración cubren lo que ningún doble puede imitar honestamente: que el
filtro por inmobiliaria esté de verdad en el SQL, el `unaccent` y el lematizador
español de Postgres, el `SKIP LOCKED` del outbox, y el HTTP real con su guardia
de sesión y su manejador de errores.

Las tres primeras suites que se escribieron encontraron tres defectos en código
que llevaba fases dando por bueno: un `findById` sin ámbito de tenant, una
reserva del outbox que no reservaba nada más allá de la sentencia, y un troceado
que no reconocía los epígrafes de Markdown pegados a su párrafo.

## Estado

| Fase | Alcance | Estado |
|---|---|---|
| F0 | Fundaciones: monorepo, kernel, eventos, outbox, DI, Prisma, CI local | ✅ |
| F1 | identity + channels (`console`) + conversation: contactos, mensajes, memoria, buffer de turno | ✅ |
| F2 | agent: `LLMProvider`, `MockLLMProvider`, herramientas, guardrails, presupuesto, traza | ✅ |
| F3 | catalog: puerto `PropertyService`, `MockPropertyService`, tools de búsqueda, snapshots | ✅ |
| F4 | leads + appointments: captura, scoring, asignación, agenda de visitas y recordatorios | ✅ |
| F5 | knowledge / RAG: ingesta, pgvector, búsqueda híbrida, respuestas con cita | ✅ |
| F6 | Canal WhatsApp: webhook firmado, credenciales cifradas, acuses de entrega | ✅ |
| F7 | Back-office React: inbox en vivo, toma de control, leads, agenda, conocimiento, configuración, simulador | ✅ |
| F8 | Proveedores reales de IA: Anthropic, OpenAI, Ollama | ✅ |
| F9 | Producción: control de coste ✅ · Row Level Security ✅ · límites de ritmo ✅ · métricas ✅ · backups, dashboards, runbook | En curso |
| F10 | Ver `docs/00-ARCHITECTURE.md` §13 | Pendiente |

### Qué hay funcionando hoy

```
CLI · WhatsApp · simulador ──HTTP──▶ channels ──evento──▶ conversation ──debounce──▶ turno
 ▲                                                                                    │
 │                                                                                    ▼
 │                                                     agent ── política determinista
 │                                                       │      (intención, escalamiento)
 │                                                       ▼
 │                                               LLMProvider ⇄ herramientas
 │                                                       │      catalog · leads · appointments
 │                                                   guardrails    knowledge
 │                                                       │
 └──────SSE──── channels ◀── conversation ◀──────────────┘
                                 │
                                 └──SSE──▶ back-office (React)  ── el asesor toma el control

        catalog ──catalog.property_shown──▶ leads ──lead.qualified──▶ …
     appointments ──appointment.reminder_due──▶ mensaje al cliente
      knowledge ──document_ingested──▶ troceado + embeddings ──▶ indexado
```

- **El asesor ve lo mismo que vio el cliente.** El panel recibe **bloques**, no HTML ni
  texto plano: las mismas fichas de inmueble con los mismos precios que salieron por
  WhatsApp, pintadas con otro estilo. Puede tomar el control de una conversación —el bot
  se calla— y devolvérsela cuando termine.
- **El simulador no tiene ruta propia.** Habla con el agente por la misma URL pública que
  usaría un cliente: mismo caso de uso, misma conversación, que aparece en el inbox como
  cualquier otra. Un atajo interno probaría un camino que nadie usa.
- **La IA es un puerto, y F8 lo demostró.** Añadir Anthropic, OpenAI y Ollama fue
  escribir adaptadores y añadir tres `case` a un `switch`. **Cero casos de uso
  tocados.** Los tres pasan la misma suite de contrato que el simulador — por eso
  cambiar de proveedor es cambiar una variable y no reescribir el agente.
- **El canal no sabe nada del negocio, y F6 lo demostró.** Añadir WhatsApp fue implementar
  `ChatChannel` y añadir una línea a una lista. **Cero casos de uso tocados**: el mismo
  agente que busca inmuebles, agenda visitas y cita el reglamento funciona por WhatsApp
  sin enterarse. No hubo nada que sacar del canal porque nunca hubo nada dentro.
- **La memoria es independiente de la IA.** `ContactProfile` guarda cada dato con su
  procedencia y su confianza: lo que dice el cliente siempre gana sobre lo que el sistema
  deduce, y el cliente puede corregirse. Es una función pura, testeada, sin un solo token.
- **Reintentar no duplica.** Un webhook reenviado se descarta por `external_message_id`.
- **Multi-tenant de verdad, en tres capas.** El mismo teléfono escribiendo a dos
  inmobiliarias son dos clientes distintos, con conversaciones y memoria separadas.
  Lo garantizan el contexto de ejecución, el filtro de cada repositorio y —desde F9—
  **Row Level Security en Postgres**, que se niega aunque el código se equivoque: una
  consulta sin `WHERE` devuelve solo lo tuyo, y sin contexto no devuelve nada.
- **Nada de OpenAI en el código.** El agente conoce `LLMProvider`; hoy lo implementa un
  simulador determinista. Los proveedores reales (F8) pasarán la misma suite de contrato
  que ya pasa el mock — por eso `LLM_PROVIDER=openai` será todo el cambio.
- **No inventa precios.** Un guardrail compara cada cifra de dinero de la respuesta con lo
  que devolvieron las herramientas. Si no cuadra, reintenta una vez y, si el modelo
  insiste, pasa la conversación a una persona antes que enviar el dato.
- **Presupuesto por turno.** Iteraciones, herramientas y tiempo. Agotarlo no deja al
  cliente sin respuesta: responde lo que tenga y escala.
- **Tres frenos distintos, para tres problemas distintos.** El presupuesto acota el
  *turno*; el tope de gasto acota el *mes* con un contador transaccional y, al agotarse,
  pasa la conversación a una persona; los límites de ritmo acotan el *minuto*. Estos
  últimos van en dos ámbitos: los mensajes de una inmobiliaria se cortan con un 429 y su
  `Retry-After` —el proveedor reintenta, así que el mensaje se aplaza y no se pierde—, y
  los turnos de un contacto que insiste sin parar se omiten con un aviso, uno solo, cada
  diez minutos. Un límite en cero significa *sin límite*: a quien olvidó configurarlo no
  se le puede apagar el agente.
- **Todo turno deja traza.** `agent_runs` y `agent_run_steps` guardan qué herramientas se
  llamaron, con qué argumentos, cuánto tardaron, qué modelo respondió y qué costó.
- **Se ve cómo va sin abrir la base.** `curl localhost:3000/metrics` da tráfico, latencias,
  turnos por desenlace, coste acumulado y el retraso del outbox en formato Prometheus.
  Ninguna etiqueta lleva un identificador: las métricas dicen *cuánto y cómo de rápido*,
  y los logs —que sí llevan `tenantId` y `correlationId`— dicen *a quién*. Etiquetar por
  inmobiliaria convertiría un panel en una factura.
- **No somos dueños del catálogo, y se nota.** No hay tabla de inmuebles. `PropertyService`
  tiene exactamente seis capacidades —buscar, obtener, características, disponibilidad,
  imágenes, enlace— y ninguna suposición sobre ningún proveedor. Lo único que guardamos es
  qué le mostramos a cada cliente y cuándo, en copias inmutables.
- **El CRM no depende de que el modelo se acuerde.** Si el catálogo mostró algo, hay ficha:
  la captura la dispara un evento, no una herramienta. El modelo puede fallar, cambiar de
  proveedor o responder raro un martes; el lead existe igual.
- **La puntuación de un lead viene con sus motivos.** "87 — pidió agendar visita (+20), vio
  4 inmuebles (+20), plazo inmediato (+10)". Un asesor sabe por dónde empezar la llamada, y
  la priorización es auditable en vez de ser una caja negra.
- **El modelo tampoco escribe fechas.** Una herramienta propone las franjas que existen de
  verdad —horario de la inmobiliaria, en su zona horaria, menos lo ya ocupado— y devuelve
  referencias opacas. El modelo solo puede elegir entre lo que se le ofreció. Al agendar se
  vuelve a comprobar todo: entre "¿te va bien el jueves?" y "sí" pasan minutos reales.
- **Una cita se mueve, no se duplica.** "Mejor el viernes" reprograma la que ya había y
  conserva su historial. Y el recordatorio sale solo, una vez, por el mismo canal.
- **Sin fuente, no hay respuesta.** El agente contesta preguntas sobre políticas y
  requisitos con el párrafo literal del documento de la inmobiliaria y su título. Si la
  documentación no dice nada, un guardrail **sustituye** lo que el modelo hubiera escrito:
  no se reintenta, porque reintentar no crea información que no existe.
- **El webhook de WhatsApp se verifica de verdad.** La firma HMAC se calcula sobre el
  cuerpo **crudo** —parsear y volver a serializar la invalida de forma intermitente— y sin
  ella la petición se rechaza con 403. Una sola URL sirve a toda la plataforma, así que el
  payload se reparte por número **antes** de resolver la inmobiliaria: dos clientes en la
  misma llamada de Meta no pueden mezclarse.
- **Los botones se degradan solos.** WhatsApp admite tres y de veinte caracteres. Cuando no
  caben —"viernes, 7 de agosto, 9:00 a. m." no cabe— se envía una lista numerada en vez de
  truncar rótulos, porque dos franjas truncadas se leerían igual. El agente no se entera.
- **Las credenciales van cifradas.** El token de cada número se guarda con AES-256-GCM en su
  cuenta de canal; un volcado de la base no basta para robarlo.
- **La búsqueda es híbrida y sin API key.** Vectores (pgvector + HNSW) para entender la
  intención, full-text en español sin tildes para los términos exactos, y fusión RRF por
  posición — porque un coseno y un `ts_rank` no son comparables. Los embeddings del modo
  demo no son ruido determinista: son una proyección de bolsa de palabras, así que dos
  textos que comparten vocabulario quedan cerca de verdad.

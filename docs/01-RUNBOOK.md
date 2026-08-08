# Runbook de operación — AgentInmobi

Este documento se lee a las tres de la mañana, con prisa y con sueño. Está
escrito para eso: procedimientos concretos, comandos copiables y, en cada
alerta, la pregunta *«¿qué le está pasando al cliente ahora mismo?»* antes que
la causa técnica.

Convención: cada alerta de `ops/prometheus/alerts.yml` tiene aquí una sección
con su mismo nombre.

---

## 0. Lo primero, siempre

```bash
curl -s localhost:3000/health/ready | jq        # ¿la API atiende?
curl -s localhost:3000/metrics | grep build_info # ¿qué versión y en qué modo?
```

Tres preguntas, en este orden:

1. **¿Hay clientes afectados?** `agentinmobi_agent_turns_total{status="FAILED"}`
   y `agentinmobi_inbound_messages_total`. Si el tráfico entra y los turnos
   salen, el problema no es urgente aunque el panel esté rojo.
2. **¿Qué cambió?** `build_info` da la versión desplegada. Casi siempre la
   respuesta es «el último despliegue».
3. **¿Se está perdiendo trabajo?** `outbox_dead_lettered_total`. Todo lo demás
   se recupera; esto no.

> **Los mensajes de los clientes no se pierden.** Un webhook rechazado con 429 o
> 5xx lo reintenta el proveedor, y la ingesta es idempotente por
> `external_message_id`. Restaurar el servicio recupera la conversación; no hay
> que reconstruir nada a mano.

### SLOs

| Objetivo | Medida | Umbral |
|---|---|---|
| La API atiende | ratio de 5xx | < 1 % en 30 días |
| El agente responde | p95 de `agent_turn_duration_seconds` | < 8 s |
| El trabajo fluye | p95 de `outbox_lag_seconds` | < 5 s |
| Nada se pierde | `outbox_dead_lettered_total` | **0, siempre** |

Ocho segundos para el p95 del turno no es un número redondo: por WhatsApp, a
partir de ahí el cliente escribe *«hola?»* — y eso genera otro turno, más coste
y una conversación peor.

---

## 1. Disponibilidad

### ApiCaida

**El cliente ve:** silencio. Escribe por WhatsApp y no contesta nadie.

1. ¿Es un despliegue? Se resuelve solo en un minuto. Si no:
2. `docker compose ps` / estado de los pods. ¿El proceso arranca y muere?
3. Mira el arranque. Las tres causas habituales, en orden de frecuencia:
   - **Configuración inválida.** El proceso NO arranca con config mala, a
     propósito: `ConfigurationError` dice exactamente qué variable falla.
   - **Falta una credencial del proveedor de IA.** Con `LLM_PROVIDER=anthropic`
     y sin `ANTHROPIC_API_KEY`, el arranque falla en el segundo cero.
   - **Postgres no responde.** Ver [BaseDeDatosCaida](#basededatoscaida).
4. **Salida de emergencia:** `LLM_PROVIDER=mock` levanta el producto entero sin
   ninguna clave. El agente responde peor, pero responde. Es preferible a
   silencio mientras se resuelve lo de fondo.

### TasaDeErrorHttpAlta

**El cliente ve:** depende de la ruta. Si son webhooks, el proveedor reintenta y
la conversación se aplaza. Si es el panel, los asesores no pueden trabajar.

```bash
curl -s localhost:3000/metrics \
  | grep 'http_requests_total.*5xx'      # ¿qué ruta concreta?
```

Con la ruta en la mano, busca en el log por `correlationId`. Los errores
operacionales salen como `warn` con su `code`; los bugs, como `error` con la
traza completa. Si el código es `UPSTREAM_*`, el problema es de un proveedor y
no nuestro: ver [ProveedorDeIaFallando](#proveedordeiafallando).

### SinTraficoEntrante

**El cliente ve:** silencio, y nosotros no nos enteramos — esta es la alerta más
importante del documento porque **todo lo demás parece correcto**.

1. Descarta lo obvio: ¿es de madrugada? ¿es domingo?
2. Comprueba el webhook desde fuera:
   ```bash
   curl -i -X POST https://<host>/api/channels/CONSOLE/<cuenta>/messages \
     -H 'content-type: application/json' \
     -d '{"from":"+573001112233","text":"prueba de sonda"}'
   ```
   Un 202 significa que la entrada funciona y el problema está aguas arriba
   (la configuración del webhook en Meta, un DNS, un balanceador).
3. Si devuelve 404, la cuenta de canal no existe o está desactivada.
4. Si devuelve 429, ver [InmobiliariaLimitada](#inmobiliarialimitada).

---

## 2. El agente

### TurnosFallando

**El cliente ve:** escribió y no le contestaron. Cada punto porcentual son
conversaciones perdidas.

1. `agent_turns_total{status="FAILED"}` sube, pero **mira antes
   `llm_requests_total{outcome!="ok"}`**: la causa más frecuente está ahí y no
   en nuestro código.
2. Los turnos que revientan dejan rastro completo en la base:
   ```sql
   SELECT id, conversation_id, status, failure_reason, model, started_at
     FROM agent_runs
    WHERE status = 'FAILED' AND started_at > now() - interval '1 hour'
    ORDER BY started_at DESC LIMIT 20;
   ```
   Y el detalle paso a paso de uno concreto:
   ```sql
   SELECT ordinal, type, name, duration_ms, error
     FROM agent_run_steps WHERE run_id = $1 ORDER BY ordinal;
   ```
   Esta consulta necesita el rol administrador o `runAcrossTenants`: con RLS,
   una sesión sin contexto de inmobiliaria no ve ni una fila.
3. Si el fallo es de una sola inmobiliaria, casi siempre es su configuración
   (tope de gasto, cuenta de canal desactivada, documento corrupto).

### AgenteLento

**El cliente ve:** un silencio largo, y suele volver a escribir — lo que genera
otro turno y encarece el problema.

Descompón la latencia antes de tocar nada; el histograma dice dónde se va:

```bash
curl -s localhost:3000/metrics | grep -E 'llm_request_duration|tool_duration' \
  | grep -E 'le="(1|2.5|5|10)"'
```

- **El modelo.** Es lo normal. `LLM_EFFORT=low` ya es el valor por defecto;
  revisa que nadie lo haya subido. Un modelo local (`ollama`) en CPU tarda
  segundos por diseño.
- **Una herramienta.** `agent_tool_duration_seconds{tool="..."}` la señala.
  Suele ser el catálogo del proveedor: su límite propio son 10 s y agotarlo
  devuelve un error al modelo, no cuelga el turno.
- **La base.** Ver [BusquedaLenta](#busquedalenta).

### ProveedorDeIaFallando

**El cliente ve:** *«te paso con un asesor»*. El producto degrada bien, pero la
cola de atención humana se está llenando ahora mismo.

1. Confirma que es el proveedor y no nosotros: la etiqueta `outcome` lleva el
   código de error (`UPSTREAM_TIMEOUT`, `UPSTREAM_UNAVAILABLE`).
2. Consulta el estado del proveedor.
3. **Cambiar de proveedor es una variable de entorno y un reinicio.** Es el
   motivo de que exista el puerto `LLMProvider`:
   ```bash
   LLM_PROVIDER=openai OPENAI_MODEL=<modelo> ...   # o anthropic, u ollama
   ```
   Ni un caso de uso, ni una política, ni una herramienta cambian.
4. Si no hay a dónde ir, `LLM_PROVIDER=mock` mantiene el producto en pie.

### CosteDisparado

**El cliente ve:** nada todavía. Se ve en la factura a fin de mes.

1. El coste por inmobiliaria **no está en las métricas** a propósito (D64).
   Está en la base, exacto:
   ```sql
   SELECT tenant_id, period, spent_usd, turns
     FROM tenant_usage_periods
    WHERE period = to_char(now(), 'YYYY-MM')
    ORDER BY spent_usd DESC LIMIT 10;
   ```
2. Si una inmobiliaria destaca, mira si es tráfico real o un bucle:
   `agent_turns_blocked_total{reason="rate_limit"}` y sus conversaciones.
3. **Freno inmediato:** ponle un tope mensual desde el panel (Configuración →
   presupuesto). Surte efecto al instante — la caché del directorio se invalida
   al guardar (D53). Los clientes pasan a un asesor en vez de quedarse sin
   respuesta.
4. Freno global: `TENANT_MONTHLY_BUDGET_USD` afecta a quien no tenga tope propio.

### InmobiliariasSinPresupuesto

**El cliente ve:** *«te paso con un asesor»*, siempre. El agente no atiende.

No es una incidencia técnica: es comercial. Avisa a quien lleve la cuenta. Si
hay que restablecer el servicio ya, sube el tope de esa inmobiliaria desde el
panel. **Ponerlo a cero significa SIN tope**, no «no gastes» (D50).

### InmobiliariaLimitada

**El cliente ve:** su mensaje tarda en entrar, pero **no se pierde**: el 429
lleva `Retry-After` y el proveedor reintenta.

```bash
curl -s localhost:3000/metrics | grep 'inbound_messages_total.*rate_limited'
```

Si es tráfico legítimo de una inmobiliaria que ha crecido, sube su cuota:
`RATE_LIMIT_TENANT_MESSAGES_PER_MINUTE` y `..._BURST`. Si es un bucle de una
integración suya, el límite está haciendo exactamente su trabajo: déjalo y
llámalos.

---

## 3. Datos y trabajo en cola

### EventosPerdidos

**El cliente ve:** algo que debía pasar y no pasó — un lead sin notificar, un
recordatorio de visita que no salió.

**Esto no se recupera solo.** Es la única alerta cuyo valor esperado es cero.

```sql
SELECT id, type, tenant_id, attempts, last_error, occurred_at
  FROM outbox_events
 WHERE status = 'DEAD_LETTERED'
 ORDER BY occurred_at DESC;
```

1. Lee `last_error`. Si la causa ya está resuelta, reprograma:
   ```sql
   UPDATE outbox_events
      SET status = 'PENDING', attempts = 0, available_at = now()
    WHERE id IN ('<id-1>', '<id-2>');
   ```
   Los consumidores son idempotentes: reintentar un evento ya procesado a
   medias es seguro por diseño.
2. Si el evento ya no tiene sentido (una cita que pasó), déjalo y anótalo.

### OutboxAtascado

**El cliente ve:** respuestas que tardan, aunque el webhook conteste 202 al
instante. Es la señal **temprana**: sube antes de que nada falle.

1. ¿Está vivo el worker? El relay corre en el rol `worker` o `all`.
2. ¿Cuánto hay pendiente?
   ```sql
   SELECT status, count(*) FROM outbox_events GROUP BY status;
   ```
3. Si hay mucho pendiente y el worker está sano, es capacidad: sube réplicas
   del worker. `SKIP LOCKED` y la reserva con tiempo de visibilidad (D42) hacen
   que varias trabajen sin pisarse.
4. Si no baja con más réplicas, mira si el retraso viene de un solo tipo de
   evento: `outbox_lag_seconds{event="..."}` lo separa.

### BaseDeDatosCaida

**El cliente ve:** silencio total. Sin base no hay conversación.

1. `curl -s localhost:3000/health/ready | jq '.dependencies'` — el detalle del
   fallo de Postgres sale ahí.
2. `docker compose ps` / `pnpm infra:up`.
3. La aplicación reconecta sola; no hace falta reiniciarla.
4. Si hay que restaurar, ver [§4](#4-copias-de-seguridad).

### BusquedaLenta

**Síntoma:** el agente responde bien pero tarda, y `agent_tool_duration_seconds{tool="search_knowledge"}` está alto.

Sospecha primero de los índices. **Ya se perdieron una vez**: `prisma migrate dev`
tira lo que no sabe modelar, y en F7 se llevó por delante el HNSW y el GIN sin
que nada fallara — las búsquedas seguían siendo correctas, solo que recorriendo
la tabla entera.

```bash
pnpm --filter @agentinmobi/api db:indexes   # idempotente: los recrea si faltan
```

Hoy lo vigilan tres cosas: el GIN está declarado en el esquema, `db:migrate` y
`db:deploy` ejecutan `db:indexes` al terminar, y un test de integración compara
`prisma/indexes/search-indexes.ts` con lo que hay en Postgres.

---

## 4. Copias de seguridad

**Un backup que nunca se ha restaurado no es un backup: es un fichero.**

```bash
pnpm db:backup           # volcado en formato personalizado, en ./backups
pnpm db:verify-restore   # lo restaura en una base desechable y lo comprueba
```

La verificación no se limita a que `pg_restore` no proteste. Comprueba lo que
este sistema necesita para seguir siendo **correcto** después de restaurar, y
cada punto está porque su ausencia falla en silencio:

| Comprobación | Qué pasa si falta |
|---|---|
| RLS activo **y forzado** | La base restaurada deja de aislar inmobiliarias. Nada falla; se ven datos ajenos. |
| Políticas `tenant_isolation` | Igual que lo anterior. |
| Permisos del rol de la aplicación | Arranca y no puede leer nada. |
| Extensiones | Sin `vector` no hay búsqueda; sin `unaccent`, «comision» deja de encontrar «comisión». |
| Índice HNSW | No da error: da búsquedas secuenciales. |
| Filas | Un volcado hecho con el rol equivocado trae el esquema entero y **cero filas**, con el mismo aspecto que uno bueno. |
| Versión del esquema | Saber a qué migración corresponde la copia. |

> El volcado se hace con `DATABASE_ADMIN_URL`, no con el rol de la aplicación.
> Ese rol no es superusuario a propósito (D55) y con RLS forzado vería cero
> filas: el backup saldría vacío y parecería perfecto.

### Restaurar en producción

```bash
# 1. Saca la API de balanceo. El worker también: no debe procesar contra una
#    base a medio restaurar.
# 2. Copia de lo que hay AHORA, aunque esté mal. Es tu único camino de vuelta.
pnpm db:backup
# 3. Restaura sobre una base nueva, nunca encima de la dañada.
pg_restore --dbname "$DATABASE_ADMIN_URL_NUEVA" backups/<fichero>.dump
# 4. Comprueba la nueva antes de apuntar nada hacia ella.
DATABASE_ADMIN_URL=<nueva> pnpm db:verify-restore backups/<fichero>.dump
# 5. Apunta DATABASE_URL a la nueva y vuelve a dar tráfico.
```

Los volcados llevan datos reales de las inmobiliarias: `backups/` está en
`.gitignore` y no debe salir de un almacenamiento cifrado.

---

## 5. Operaciones habituales

### Desplegar

```bash
pnpm verify:full          # tipos, lint, arquitectura, unitarios e integración
pnpm db:backup            # antes de migrar, siempre
pnpm db:deploy            # provisiona el rol, migra y asegura los índices
```

`db:deploy` es idempotente y reafirma en cada ejecución los atributos del rol de
la aplicación: un `BYPASSRLS` puesto «para depurar» y olvidado se revierte solo
(D55).

### Volver atrás

El código se revierte con el despliegue anterior. **Las migraciones no se
revierten automáticamente**: Prisma no genera el `down`. Si una migración es
destructiva, la vuelta atrás es restaurar la copia previa — por eso el backup va
antes de migrar y no después.

### Girar la clave de cifrado

`ENCRYPTION_KEY` cifra las credenciales de las cuentas de canal. Cambiarla sin
volver a cifrar deja las cuentas ilegibles y **el canal deja de enviar**. Hoy no
hay procedimiento de rotación automatizado: si hay que cambiarla, hay que volver
a registrar las credenciales de cada cuenta desde el panel.

### Pausar el agente de una inmobiliaria

Desde el panel, un asesor toma el control de una conversación y el bot se
retira. Para pausarlo por completo, desactiva su cuenta de canal: la ingesta
devuelve 403 y deja de crear conversaciones.

---

## 6. Lo que este runbook todavía no cubre

Escrito aquí y no en la cabeza de nadie:

- **No hay copias automáticas programadas.** Los comandos existen y están
  probados; falta el `cron` o el equivalente del proveedor. Hasta entonces, el
  backup es manual y por tanto no existe cuando haga falta.
- **No hay paneles.** Las alertas de `ops/prometheus/alerts.yml` están escritas;
  falta montar Prometheus y dibujar las gráficas.
- **No hay evaluación automática de calidad del agente.** Es la carencia más
  seria del producto: un cambio de prompt o una versión nueva de un modelo
  pueden degradar las respuestas sin que ningún test lo note. Los guardrails
  impiden los fallos graves —inventar precios, citar lo que no existe— pero no
  miden si el agente responde *bien*.
- **No hay simulacro de restauración periódico.** `pnpm db:verify-restore` se
  ejecuta a mano.

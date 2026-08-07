import type {
  AgentToneContract,
  ChannelAccountContract,
  SettingsResponse,
  UpdateAgentSettingsRequest,
  UsageSummary,
} from "@agentinmobi/contracts";
import { useEffect, useState, type ReactNode, type SyntheticEvent } from "react";
import { api } from "../api/backoffice";
import { ApiError } from "../api/client";

const TONES: readonly { value: AgentToneContract; label: string; hint: string }[] = [
  { value: "CERCANO", label: "Cercano", hint: "Tutea y acompaña. El de una inmobiliaria de barrio." },
  { value: "FORMAL", label: "Formal", hint: "Trata de usted. Alto valor, obra nueva, corporativo." },
  { value: "NEUTRO", label: "Neutro", hint: "Directo y sin adornos." },
];

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] as const;

/** Céntimos incluidos: un turno cuesta millonésimas y redondear lo esconde. */
const money = (usd: number): string =>
  usd.toLocaleString("es-CO", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const channelLabel = (channel: ChannelAccountContract): string =>
  channel.channelType === "CONSOLE" ? "Simulador" : channel.channelType;

/**
 * Configuración del agente.
 *
 * Lo que se toca aquí es NEGOCIO: cómo se llama el asistente, con qué tono
 * habla, en qué horario propone visitas y cuántos intentos fallidos aguanta
 * antes de llamar a una persona. Nada de esto menciona un proveedor de IA, y
 * por eso sobrevive a cambiarlo.
 *
 * Lo que sí depende del proveedor se muestra pero no se edita: el modelo se
 * elige al desplegar. Cambiar el de embeddings desde una pantalla invalidaría
 * en silencio todo lo indexado — los vectores de dos modelos no se pueden
 * comparar, y el resultado no sería "peor": sería sin sentido.
 */
export const SettingsPage = (): ReactNode => {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [channels, setChannels] = useState<ChannelAccountContract[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [draft, setDraft] = useState<UpdateAgentSettingsRequest>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .settings()
      .then(setSettings)
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "No se pudo cargar la configuración");
      });

    api
      .channelAccounts()
      .then((response) => {
        setChannels(response.items);
      })
      .catch(() => {
        // Los canales son informativos: si fallan, la configuración sigue
        // siendo editable. No se convierte en un error de pantalla completa.
      });

    api
      .usage()
      .then(setUsage)
      .catch(() => {
        // Igual que los canales: informativo, no bloqueante.
      });
  }, []);

  if (settings === null) {
    return (
      <div className="page">
        {error !== null ? <p className="error">{error}</p> : <p className="empty">Cargando…</p>}
      </div>
    );
  }

  const { agent, tenant, runtime, canEdit } = settings;
  /** Lo que se está editando, o lo guardado si nadie ha tocado ese campo. */
  const value = { ...agent, ...draft };
  const hours = value.businessHours ?? { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00" };
  const dirty = Object.keys(draft).length > 0;

  const patch = (changes: UpdateAgentSettingsRequest): void => {
    setDraft((current) => ({ ...current, ...changes }));
    setNotice(null);
  };

  const toggleDay = (day: number): void => {
    const days = hours.days.includes(day)
      ? hours.days.filter((item) => item !== day)
      : [...hours.days, day].sort((a, b) => a - b);
    // Un horario sin días no es un horario: se ignora el clic en vez de
    // enviar algo que el dominio va a rechazar.
    if (days.length === 0) return;
    patch({ businessHours: { ...hours, days } });
  };

  const save = (event: SyntheticEvent): void => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    api
      .updateSettings(draft)
      .then((updated) => {
        setSettings(updated);
        setDraft({});
        setNotice("Configuración guardada. Se aplica desde la siguiente respuesta del agente.");
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "No se pudo guardar");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="page">
      <div className="page__header">
        <h1>Configuración del agente</h1>
        <span className="page__count">{tenant.name}</span>
      </div>

      {error !== null && <p className="error">{error}</p>}
      {notice !== null && <p className="notice">{notice}</p>}
      {!canEdit && (
        <p className="notice">
          Tu rol permite ver la configuración, no cambiarla. Cómo habla el agente afecta a todas
          las conversaciones de la inmobiliaria.
        </p>
      )}

      <form className="settings" onSubmit={save}>
        <fieldset className="settings__group" disabled={!canEdit || busy}>
          <legend>Cómo se presenta</legend>

          <label className="field">
            <span>Nombre del asistente</span>
            <input
              value={value.agentDisplayName}
              maxLength={60}
              onChange={(event) => {
                patch({ agentDisplayName: event.target.value });
              }}
            />
          </label>

          <div className="field">
            <span>Tono</span>
            <div className="filters">
              {TONES.map((tone) => (
                <button
                  key={tone.value}
                  type="button"
                  title={tone.hint}
                  className={`chip${value.tone === tone.value ? " is-active" : ""}`}
                  onClick={() => {
                    patch({ tone: tone.value });
                  }}
                >
                  {tone.label}
                </button>
              ))}
            </div>
            <span className="hint">
              {TONES.find((tone) => tone.value === value.tone)?.hint ?? ""}
            </span>
          </div>

          <label className="field">
            <span>Mensaje de bienvenida</span>
            <textarea
              rows={3}
              maxLength={500}
              value={value.welcomeMessage ?? ""}
              placeholder="Hola, soy el asistente de…"
              onChange={(event) => {
                patch({ welcomeMessage: event.target.value });
              }}
            />
          </label>
        </fieldset>

        <fieldset className="settings__group" disabled={!canEdit || busy}>
          <legend>Horario de atención</legend>
          <span className="hint">
            Franja en la que el agente propone visitas. Va en la zona horaria de la inmobiliaria
            ({tenant.timezone}), no en la de quien mira la pantalla.
          </span>

          <div className="filters">
            {DAYS.map((label, day) => (
              <button
                key={label}
                type="button"
                className={`chip${hours.days.includes(day) ? " is-active" : ""}`}
                onClick={() => {
                  toggleDay(day);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="settings__row">
            <label className="field">
              <span>Desde</span>
              <input
                type="time"
                value={hours.from}
                onChange={(event) => {
                  patch({ businessHours: { ...hours, from: event.target.value } });
                }}
              />
            </label>
            <label className="field">
              <span>Hasta</span>
              <input
                type="time"
                value={hours.to}
                onChange={(event) => {
                  patch({ businessHours: { ...hours, to: event.target.value } });
                }}
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="settings__group" disabled={!canEdit || busy}>
          <legend>Cuándo llamar a una persona</legend>

          <label className="field">
            <span>Turnos fallidos seguidos antes de escalar</span>
            <input
              type="number"
              min={1}
              max={10}
              value={value.maxConsecutiveFailedTurns}
              onChange={(event) => {
                patch({ maxConsecutiveFailedTurns: Number(event.target.value) });
              }}
            />
            <span className="hint">
              Cuanto más bajo, antes entra un asesor. Es la diferencia entre un cliente atendido y
              un cliente peleándose con un bot.
            </span>
          </label>

          <label className="field">
            <span>Correo de avisos</span>
            <input
              type="email"
              value={value.handoffEmail ?? ""}
              placeholder="asesores@inmobiliaria.co"
              onChange={(event) => {
                patch({ handoffEmail: event.target.value });
              }}
            />
          </label>
        </fieldset>

        <fieldset className="settings__group" disabled={!canEdit || busy}>
          <legend>Gasto en IA</legend>

          {usage !== null && (
            <div className="usage">
              <div className="usage__figures">
                <strong>{money(usage.spentUsd)}</strong>
                <span className="hint">
                  {usage.limitUsd > 0 ? `de ${money(usage.limitUsd)}` : "sin tope"} ·{" "}
                  {usage.turns} turnos en {usage.period}
                </span>
              </div>
              {usage.limitUsd > 0 && (
                <div className="usage__bar">
                  <div
                    className={`usage__fill${usage.ratio >= 0.8 ? " is-warning" : ""}`}
                    style={{ width: `${String(Math.min(usage.ratio * 100, 100))}%` }}
                  />
                </div>
              )}
            </div>
          )}

          <label className="field">
            <span>Tope mensual (USD)</span>
            <input
              type="number"
              min={0}
              step={1}
              value={value.monthlyBudgetUsd ?? 0}
              onChange={(event) => {
                patch({ monthlyBudgetUsd: Number(event.target.value) });
              }}
            />
            <span className="hint">
              <strong>Cero significa sin tope</strong>, no «no gastes nada»: a quien se le
              olvida configurarlo no se le puede apagar el agente. Al alcanzarlo, las
              conversaciones pasan a un asesor en vez de quedarse sin respuesta.
            </span>
          </label>
        </fieldset>

        {canEdit && (
          <div className="settings__actions">
            <button type="submit" className="button button--primary" disabled={busy || !dirty}>
              {busy ? "Guardando…" : "Guardar cambios"}
            </button>
            {dirty && (
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  setDraft({});
                }}
              >
                Descartar
              </button>
            )}
          </div>
        )}
      </form>

      <div className="settings__group">
        <h2 className="settings__legend">Cómo está desplegado</h2>
        <span className="hint">
          Solo lectura: se fija al desplegar, no desde aquí. Cambiar el modelo de embeddings sin
          reindexar dejaría la búsqueda comparando vectores de dos espacios distintos.
        </span>

        <table className="table">
          <tbody>
            <tr>
              <td>Modelo de lenguaje</td>
              <td>
                <code>{runtime.llmProvider}</code>
              </td>
            </tr>
            <tr>
              <td>Modelo de embeddings</td>
              <td>
                <code>{runtime.embeddingProvider}</code>
              </td>
            </tr>
            <tr>
              <td>Modo</td>
              <td>
                {runtime.demoMode
                  ? "Demo — funciona entero sin ninguna clave de API"
                  : "Proveedor externo activo"}
              </td>
            </tr>
            <tr>
              <td>Zona horaria · moneda</td>
              <td>
                {tenant.timezone} · {tenant.currency}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="settings__group">
        <h2 className="settings__legend">Canales conectados</h2>
        {channels.length === 0 ? (
          <p className="empty">No hay ningún canal dado de alta.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Canal</th>
                <th>Cuenta</th>
                <th>Identificador</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((channel) => (
                <tr key={channel.id}>
                  <td>{channelLabel(channel)}</td>
                  <td>{channel.displayName}</td>
                  <td className="cell--muted">
                    <code>{channel.externalId}</code>
                  </td>
                  <td>{channel.isActive ? "Activo" : "Desactivado"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

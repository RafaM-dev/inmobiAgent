import type { LeadSummaryContract } from "@agentinmobi/contracts";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/backoffice";
import { ApiError } from "../api/client";

const STATUS_LABEL: Record<string, string> = {
  NEW: "Nuevo",
  CONTACTED: "Contactado",
  QUALIFIED: "Cualificado",
  SCHEDULED: "Con visita",
  WON: "Ganado",
  LOST: "Perdido",
};

const BAND_LABEL: Record<string, string> = { HOT: "Caliente", WARM: "Tibio", COLD: "Frío" };

const FILTERS = [
  { key: "", label: "Todos" },
  { key: "HOT", label: "Calientes" },
  { key: "WARM", label: "Tibios" },
] as const;

/**
 * Bandeja de leads.
 *
 * Ordenada por puntuación, que es la pregunta que un asesor se hace al abrirla:
 * a quién llamo ahora. Cada fila lleva al hilo de su conversación, porque lo
 * primero que se quiere ver antes de llamar es qué se dijo.
 */
export const LeadsPage = (): ReactNode => {
  const navigate = useNavigate();
  const [items, setItems] = useState<LeadSummaryContract[]>([]);
  const [band, setBand] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .leads(band !== "" ? { band } : {})
      .then((response) => {
        setItems(response.items);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "No se pudieron cargar los leads");
      });
  }, [band]);

  return (
    <div className="page">
      <div className="page__header">
        <h1>Leads</h1>
        <span className="page__count">{items.length}</span>
      </div>

      <div className="filters">
        {FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            className={`chip${band === filter.key ? " is-active" : ""}`}
            onClick={() => {
              setBand(filter.key);
            }}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {error !== null && <p className="error">{error}</p>}
      {items.length === 0 && error === null && <p className="empty">Todavía no hay leads.</p>}

      {items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Puntuación</th>
              <th>Estado</th>
              <th>Inmuebles vistos</th>
              <th>Asignado</th>
              <th>Última actividad</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((lead) => (
              <tr key={lead.id}>
                <td>
                  <span className={`badge badge--${lead.band.toLowerCase()}`}>
                    {lead.score} · {BAND_LABEL[lead.band] ?? lead.band}
                  </span>
                </td>
                <td>{STATUS_LABEL[lead.status] ?? lead.status}</td>
                <td>{lead.interestCount}</td>
                <td>{lead.assignedUserId === undefined ? "Sin asignar" : "Asignado"}</td>
                <td>
                  {new Date(lead.lastActivityAt).toLocaleString("es-CO", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => {
                      void navigate(`/inbox/${lead.conversationId}`);
                    }}
                  >
                    Ver conversación
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

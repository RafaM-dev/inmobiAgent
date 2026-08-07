import type { AppointmentSummaryContract } from "@agentinmobi/contracts";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/backoffice";
import { ApiError } from "../api/client";

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Solicitada",
  CONFIRMED: "Confirmada",
  RESCHEDULED: "Reprogramada",
  CANCELLED: "Cancelada",
  COMPLETED: "Realizada",
  NO_SHOW: "No asistió",
};

/**
 * Agenda de visitas.
 *
 * La hora que se muestra es la ETIQUETA que calculó el servidor en la zona
 * horaria de la inmobiliaria, no una fecha reinterpretada por el navegador. Un
 * asesor de viaje no puede ver una hora distinta de la que le dijeron al
 * cliente.
 */
export const AgendaPage = (): ReactNode => {
  const navigate = useNavigate();
  const [items, setItems] = useState<AppointmentSummaryContract[]>([]);
  const [days, setDays] = useState(7);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .appointments({ days })
      .then((response) => {
        setItems(response.items);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "No se pudo cargar la agenda");
      });
  }, [days]);

  return (
    <div className="page">
      <div className="page__header">
        <h1>Agenda</h1>
        <span className="page__count">{items.length} visitas</span>
      </div>

      <div className="filters">
        {[7, 30, 90].map((option) => (
          <button
            key={option}
            type="button"
            className={`chip${days === option ? " is-active" : ""}`}
            onClick={() => {
              setDays(option);
            }}
          >
            {option} días
          </button>
        ))}
      </div>

      {error !== null && <p className="error">{error}</p>}
      {items.length === 0 && error === null && (
        <p className="empty">No hay visitas agendadas en este periodo.</p>
      )}

      {items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Cuándo</th>
              <th>Estado</th>
              <th>Inmueble</th>
              <th>Duración</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((appointment) => (
              <tr key={appointment.id}>
                <td>{appointment.label}</td>
                <td>{STATUS_LABEL[appointment.status] ?? appointment.status}</td>
                <td>{appointment.propertyRef ?? "Por definir"}</td>
                <td>{appointment.durationMin} min</td>
                <td>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => {
                      void navigate(`/inbox/${appointment.conversationId}`);
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

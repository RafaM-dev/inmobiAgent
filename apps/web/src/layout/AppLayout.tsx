import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useSession } from "../auth/session-context";

const NAV = [
  { to: "/inbox", label: "Conversaciones" },
  { to: "/leads", label: "Leads" },
  { to: "/agenda", label: "Agenda" },
  { to: "/conocimiento", label: "Conocimiento" },
  { to: "/simulador", label: "Simulador" },
  { to: "/configuracion", label: "Configuración" },
] as const;

/** Marco del back-office: navegación, quién está dentro y salida. */
export const AppLayout = (): ReactNode => {
  const { state, logout } = useSession();
  const session = state.status === "authenticated" ? state.session : null;

  return (
    <div className="shell">
      <aside className="shell__nav">
        <div className="shell__brand">
          <strong>AgentInmobi</strong>
          <span className="shell__tenant">{session?.tenantName ?? ""}</span>
        </div>

        <nav>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `shell__link${isActive ? " is-active" : ""}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="shell__user">
          <span className="shell__user-name">{session?.user.displayName ?? ""}</span>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              void logout();
            }}
          >
            Salir
          </button>
        </div>
      </aside>

      <main className="shell__content">
        <Outlet />
      </main>
    </div>
  );
};

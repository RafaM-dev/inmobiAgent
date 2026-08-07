import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useSession } from "./auth/session-context";
import { AppLayout } from "./layout/AppLayout";
import { AgendaPage } from "./pages/AgendaPage";
import { InboxPage } from "./pages/InboxPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { LeadsPage } from "./pages/LeadsPage";
import { LoginPage } from "./pages/LoginPage";
import { PlaygroundPage } from "./pages/PlaygroundPage";
import { SettingsPage } from "./pages/SettingsPage";

/**
 * Raíz de la aplicación.
 *
 * Mientras se resuelve la sesión no se decide nada: pintar el login antes de
 * saber si hay sesión produce un parpadeo en cada recarga y, peor, echa al
 * asesor de la pantalla en la que estaba.
 */
export const App = (): ReactNode => {
  const { state } = useSession();

  if (state.status === "loading") {
    return <div className="boot">Cargando…</div>;
  }

  if (state.status === "anonymous") {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/inbox/:conversationId" element={<InboxPage />} />
        <Route path="/leads" element={<LeadsPage />} />
        <Route path="/agenda" element={<AgendaPage />} />
        <Route path="/conocimiento" element={<KnowledgePage />} />
        <Route path="/simulador" element={<PlaygroundPage />} />
        <Route path="/configuracion" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/inbox" replace />} />
      </Route>
    </Routes>
  );
};

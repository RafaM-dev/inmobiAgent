import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { useSession } from "./auth/session-context";
import { AppLayout } from "./layout/AppLayout";
import { AgendaPage } from "./pages/AgendaPage";
import { InboxPage } from "./pages/InboxPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { LeadsPage } from "./pages/LeadsPage";
import { LoginPage } from "./pages/LoginPage";
import { PlaygroundPage } from "./pages/PlaygroundPage";
import { RedeemPage } from "./pages/RedeemPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TeamPage } from "./pages/TeamPage";

/**
 * Esqueleto de arranque.
 *
 * Con la forma del panel, no un «Cargando…» centrado: la pantalla no salta
 * cuando llegan los datos, y quien la mira ya sabe qué va a aparecer dónde.
 */
const BootSkeleton = (): ReactNode => (
  <div className="flex min-h-screen">
    <div className="bg-sidebar hidden w-60 shrink-0 border-r p-4 md:block">
      <Skeleton className="h-8 w-36" />
      <div className="mt-8 space-y-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-8 w-full" />
        ))}
      </div>
    </div>
    <div className="flex-1 space-y-4 p-6">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-64 w-full" />
    </div>
  </div>
);

/**
 * Raíz de la aplicación.
 *
 * Mientras se resuelve la sesión no se decide nada: pintar el login antes de
 * saber si hay sesión produce un parpadeo en cada recarga y, peor, echa al
 * asesor de la pantalla en la que estaba.
 */
export const App = (): ReactNode => {
  const { state } = useSession();

  return (
    <>
      {state.status === "loading" && <BootSkeleton />}

      {/*
       * Sin sesión también hay rutas, no solo el acceso: quien abre el enlace de
       * una invitación o de un restablecimiento viene por definición sin sesión.
       * Antes, cualquier ruta caía en la pantalla de acceso y esos enlaces no
       * llevaban a ninguna parte.
       */}
      {state.status === "anonymous" && (
        <Routes>
          <Route path="/aceptar-invitacion" element={<RedeemPage mode="invitation" />} />
          <Route path="/restablecer-contrasena" element={<RedeemPage mode="reset" />} />
          <Route path="*" element={<LoginPage />} />
        </Routes>
      )}

      {state.status === "authenticated" && (
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/inbox/:conversationId" element={<InboxPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/agenda" element={<AgendaPage />} />
            <Route path="/conocimiento" element={<KnowledgePage />} />
            <Route path="/simulador" element={<PlaygroundPage />} />
            <Route path="/equipo" element={<TeamPage />} />
            <Route path="/configuracion" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/inbox" replace />} />
          </Route>
        </Routes>
      )}

      {/*
       * Un solo sitio para los avisos de toda la aplicación. Antes cada pantalla
       * pintaba su propio párrafo verde y el asesor no sabía dónde mirar.
       */}
      <Toaster position="bottom-right" richColors closeButton />
    </>
  );
};

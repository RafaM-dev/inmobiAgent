import {
  BookOpen,
  CalendarDays,
  LogOut,
  type LucideIcon,
  MessagesSquare,
  Settings,
  Sparkles,
  UserCog,
  Users,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { ThemeToggle } from "@/components/theme";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useSession } from "../auth/session-context";

interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

const NAV: readonly NavItem[] = [
  { to: "/inbox", label: "Conversaciones", icon: MessagesSquare },
  { to: "/leads", label: "Leads", icon: Users },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/conocimiento", label: "Conocimiento", icon: BookOpen },
  { to: "/simulador", label: "Simulador", icon: Sparkles },
  { to: "/equipo", label: "Equipo", icon: UserCog },
  { to: "/configuracion", label: "Configuración", icon: Settings },
];

/** Iniciales para el avatar. Sin foto: nadie sube una en una herramienta interna. */
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

/**
 * Marco del back-office: navegación, quién está dentro y salida.
 *
 * La navegación lleva iconos además de texto. No es adorno: un asesor que usa
 * esto ocho horas deja de leer las etiquetas a la segunda semana y navega por
 * forma y posición. Quitar el texto sería lo contrario —obligaría a aprender
 * seis pictogramas— así que van los dos.
 */
export const AppLayout = (): ReactNode => {
  const { state, logout } = useSession();
  const session = state.status === "authenticated" ? state.session : null;
  const [salir, setSalir] = useState(false);

  return (
    <div className="bg-background flex min-h-screen">
      <aside className="bg-sidebar text-sidebar-foreground sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r md:flex">
        <div className="flex h-14 items-center gap-2 px-4">
          <div className="bg-primary text-primary-foreground grid size-7 shrink-0 place-items-center rounded-md">
            <MessagesSquare className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm leading-tight font-semibold">AgentInmobi</div>
            <div className="text-muted-foreground truncate text-xs leading-tight">
              {session?.tenantName ?? ""}
            </div>
          </div>
        </div>

        <Separator />

        <ScrollArea className="flex-1">
          <nav className="space-y-0.5 p-2">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    "focus-visible:ring-sidebar-ring outline-none focus-visible:ring-2",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground",
                  )
                }
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </NavLink>
            ))}
          </nav>
        </ScrollArea>

        <Separator />

        <div className="flex items-center gap-2 p-3">
          <Avatar className="size-7">
            <AvatarFallback className="text-[10px]">
              {initials(session?.user.displayName ?? "")}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{session?.user.displayName ?? ""}</div>
            <div className="text-muted-foreground truncate text-[11px]">
              {session?.user.email ?? ""}
            </div>
          </div>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Salir"
            disabled={salir}
            onClick={() => {
              setSalir(true);
              // No se reactiva al terminar: al cerrar sesión este layout
              // desaparece, y volver a habilitarlo sería escribir sobre un
              // componente desmontado.
              void logout().catch(() => {
                setSalir(false);
              });
            }}
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </aside>

      {/*
       * Navegación de móvil. El panel se diseña para escritorio —es donde se
       * trabaja— pero un asesor consulta el inbox desde el teléfono, y una
       * barra lateral oculta sin alternativa lo dejaría sin poder navegar.
       */}
      <div className="bg-sidebar fixed inset-x-0 bottom-0 z-20 flex border-t md:hidden">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            aria-label={label}
            className={({ isActive }) =>
              cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]",
                isActive ? "text-primary" : "text-muted-foreground",
              )
            }
          >
            <Icon className="size-4" />
          </NavLink>
        ))}
      </div>

      <main className="min-w-0 flex-1 pb-14 md:pb-0">
        <Outlet />
      </main>
    </div>
  );
};

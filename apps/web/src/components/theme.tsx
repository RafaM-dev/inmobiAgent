import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Tema claro / oscuro / el del sistema.
 *
 * Hay tres opciones y no dos a propósito. «El del sistema» es lo que hace que
 * el panel siga al sistema operativo cuando anochece sin que nadie toque nada,
 * y es lo que la mayoría deja puesto. Pero un asesor en una oficina con mala
 * luz quiere poder fijarlo, y esa elección tiene que sobrevivir a la recarga.
 *
 * Se guarda en `localStorage` porque es una preferencia del DISPOSITIVO, no de
 * la persona: el mismo asesor puede querer claro en la oficina y oscuro en su
 * portátil por la noche. Llevarlo al servidor lo haría global y peor.
 */

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "agentinmobi.theme";

const isTheme = (value: string | null): value is Theme =>
  value === "light" || value === "dark" || value === "system";

export const readTheme = (): Theme => {
  // `localStorage` lanza en modo privado en algunos navegadores. Que el panel
  // no arranque por no poder leer una preferencia de color sería absurdo.
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : "system";
  } catch {
    return "system";
  }
};

const remember = (theme: Theme): void => {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Se pierde la preferencia al recargar. Es un mal menor.
  }
};

/** Aplica el tema al documento. Es lo único que toca el DOM directamente. */
export const applyTheme = (theme: Theme): void => {
  const prefiereOscuro = matchMedia("(prefers-color-scheme: dark)").matches;
  const oscuro = theme === "dark" || (theme === "system" && prefiereOscuro);
  document.documentElement.classList.toggle("dark", oscuro);
};

const OPCIONES: readonly { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Claro", Icon: Sun },
  { value: "dark", label: "Oscuro", Icon: Moon },
  { value: "system", label: "El del sistema", Icon: Monitor },
];

export const ThemeToggle = (): ReactNode => {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    applyTheme(theme);
    remember(theme);

    // Con "el del sistema", seguir al sistema en vivo: si el portátil cambia a
    // oscuro al anochecer, el panel cambia con él sin recargar.
    if (theme !== "system") return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const seguir = (): void => {
      applyTheme("system");
    };
    media.addEventListener("change", seguir);
    return () => {
      media.removeEventListener("change", seguir);
    };
  }, [theme]);

  const Icono = OPCIONES.find((option) => option.value === theme)?.Icon ?? Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" className="size-8" aria-label="Cambiar tema">
            <Icono className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {OPCIONES.map(({ value, label, Icon }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => {
              setTheme(value);
            }}
          >
            <Icon className="size-4" />
            {label}
            {theme === value && <span className="text-muted-foreground ml-auto text-xs">✓</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

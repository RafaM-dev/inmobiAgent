import type { SessionResponse } from "@agentinmobi/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/backoffice";
import { ApiError } from "../api/client";
import { SessionProvider, useSession } from "./session-context";

/**
 * SESIÓN DEL ASESOR.
 *
 * Una máquina de estados con tres posiciones y consecuencias grandes en las
 * tres. Si `loading` se resuelve mal, el asesor ve la pantalla de acceso aunque
 * tenga sesión —o peor, ve el panel vacío creyendo que no hay conversaciones—.
 *
 * Se prueba a través de un componente, no llamando al hook a pelo: lo que
 * importa es lo que acaba en pantalla.
 */

const Pantalla = (): ReactNode => {
  const { state, login, logout } = useSession();

  return (
    <div>
      <span data-testid="estado">{state.status}</span>
      {state.status === "authenticated" && (
        <span data-testid="quien">{state.session.user.email}</span>
      )}
      <button
        onClick={() => {
          void login({ tenantSlug: "demo", email: "a@b.co", password: "x" }).catch(() => undefined);
        }}
      >
        entrar
      </button>
      <button
        onClick={() => {
          void logout();
        }}
      >
        salir
      </button>
    </div>
  );
};

const SESION: SessionResponse = {
  user: {
    userId: "019fd528-f63e-74de-8fe5-bdd2a45333ac",
    tenantId: "019fd528-f63e-74de-8fe5-bdd2a45333ad",
    email: "asesor@demo.co",
    displayName: "Asesor",
    role: "AGENT",
  },
  tenantSlug: "inmobiliaria-demo",
  tenantName: "Inmobiliaria Demo",
  expiresAt: "2026-12-31T00:00:00.000Z",
};

const montar = () =>
  render(
    <SessionProvider>
      <Pantalla />
    </SessionProvider>,
  );

const estado = () => screen.getByTestId("estado").textContent;

describe("Sesión del asesor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("empieza preguntando al servidor, no dando nada por hecho", () => {
    // Una promesa que no se resuelve: el estado se queda donde arranca.
    vi.spyOn(api, "me").mockReturnValue(new Promise(() => undefined));

    montar();

    /*
     * `loading` es un estado de verdad y no un detalle: pintar la pantalla de
     * acceso mientras se comprueba haría parpadear el login en cada recarga a
     * quien SÍ tiene sesión.
     */
    expect(estado()).toBe("loading");
  });

  it("con sesión válida entra directo", async () => {
    vi.spyOn(api, "me").mockResolvedValue(SESION);

    montar();

    await waitFor(() => {
      expect(estado()).toBe("authenticated");
    });
    expect(screen.getByTestId("quien").textContent).toBe("asesor@demo.co");
  });

  it("un 401 al arrancar es lo normal: aún no hay sesión", async () => {
    vi.spyOn(api, "me").mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "No autenticado"));

    montar();

    await waitFor(() => {
      expect(estado()).toBe("anonymous");
    });
  });

  it("si la API está caída, el panel se queda en la pantalla de acceso", async () => {
    vi.spyOn(api, "me").mockRejectedValue(new TypeError("Failed to fetch"));

    montar();

    /*
     * No se queda colgado en `loading` para siempre. El asesor ve el login y
     * puede intentarlo, que es infinitamente mejor que una pantalla en blanco
     * sin explicación.
     */
    await waitFor(() => {
      expect(estado()).toBe("anonymous");
    });
  });

  it("entrar deja la sesión disponible para todo el panel", async () => {
    vi.spyOn(api, "me").mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "No autenticado"));
    const login = vi.spyOn(api, "login").mockResolvedValue(SESION);

    montar();
    await waitFor(() => {
      expect(estado()).toBe("anonymous");
    });

    await userEvent.click(screen.getByText("entrar"));

    await waitFor(() => {
      expect(estado()).toBe("authenticated");
    });
    expect(login).toHaveBeenCalledWith({ tenantSlug: "demo", email: "a@b.co", password: "x" });
  });

  it("un acceso fallido NO deja el panel medio abierto", async () => {
    vi.spyOn(api, "me").mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "No autenticado"));
    vi.spyOn(api, "login").mockRejectedValue(
      new ApiError(401, "UNAUTHORIZED", "Credenciales inválidas"),
    );

    montar();
    await waitFor(() => {
      expect(estado()).toBe("anonymous");
    });

    await userEvent.click(screen.getByText("entrar"));

    // Sigue anónimo. El error lo muestra la pantalla de acceso; el estado no
    // puede quedar a medias.
    await waitFor(() => {
      expect(estado()).toBe("anonymous");
    });
  });

  it("salir cierra la sesión en el servidor antes de olvidarla aquí", async () => {
    vi.spyOn(api, "me").mockResolvedValue(SESION);
    const logout = vi.spyOn(api, "logout").mockResolvedValue(undefined);

    montar();
    await waitFor(() => {
      expect(estado()).toBe("authenticated");
    });

    await userEvent.click(screen.getByText("salir"));

    /*
     * El orden importa: si el panel olvidara la sesión sin avisar al servidor,
     * la cookie seguiría siendo válida y cualquiera con ese navegador entraría
     * de nuevo. Las sesiones son revocables en servidor y hay que revocarlas.
     */
    expect(logout).toHaveBeenCalled();
    await waitFor(() => {
      expect(estado()).toBe("anonymous");
    });
  });

  it("cancela la comprobación de sesión al desmontar", () => {
    let recibida: AbortSignal | undefined;
    vi.spyOn(api, "me").mockImplementation((signal?: AbortSignal) => {
      recibida = signal;
      return new Promise(() => undefined);
    });

    const { unmount } = montar();
    expect(recibida?.aborted).toBe(false);

    unmount();

    /*
     * Sin esto, un asesor que navega deprisa deja peticiones vivas que se
     * resuelven contra un componente que ya no existe. Se aborta de verdad, no
     * se ignora el resultado: la petición se corta en el navegador.
     */
    expect(recibida?.aborted).toBe(true);
  });

  it("usar la sesión fuera del proveedor es un error de programación, y se dice", () => {
    // Silencia el error que React imprime al propagar la excepción.
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => render(<Pantalla />)).toThrow(/fuera de SessionProvider/);
  });
});

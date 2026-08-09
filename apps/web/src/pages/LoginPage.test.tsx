import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { LoginPage } from "./LoginPage";

/**
 * PANTALLA DE ACCESO.
 *
 * Es la primera pantalla y la que más se ve cuando algo va mal. Lo que se
 * comprueba aquí no es el diseño: es que la contraseña no se pueda leer, que el
 * error del servidor llegue tal cual al asesor, y que no se pueda enviar el
 * formulario dos veces.
 */

/**
 * Se sustituye la sesión, no la API.
 *
 * La pantalla de acceso solo sabe llamar a `login` y pintar lo que falle: qué
 * hace `login` por dentro es cosa de `session-context`, que tiene su propia
 * prueba. Bajar hasta `fetch` aquí acoplaría este test a decisiones que no son
 * suyas.
 */
const mockLogin = vi.fn();
vi.mock("../auth/session-context", () => ({
  useSession: () => ({ login: mockLogin, logout: vi.fn(), state: { status: "anonymous" } }),
}));

const campos = () => ({
  inmobiliaria: screen.getByLabelText("Inmobiliaria"),
  correo: screen.getByLabelText("Correo"),
  contrasena: screen.getByLabelText("Contraseña"),
  // "Entrar" o "Entrando…": es el mismo botón, y la prueba del doble envío
  // necesita encontrarlo justamente cuando ha cambiado de texto.
  entrar: screen.getByRole("button", { name: /entrar|entrando/i }),
});

describe("Pantalla de acceso", () => {
  it("pide la inmobiliaria además del correo", () => {
    render(<LoginPage />);

    /*
     * La misma persona puede trabajar para dos inmobiliarias. Sin este campo el
     * sistema tendría que adivinar, y adivinar en autenticación acaba mal.
     */
    expect(campos().inmobiliaria).toBeDefined();
  });

  it("la contraseña no se puede leer de la pantalla", () => {
    render(<LoginPage />);

    expect(campos().contrasena.getAttribute("type")).toBe("password");
  });

  it("los campos se anuncian al gestor de contraseñas", () => {
    render(<LoginPage />);
    const { correo, contrasena } = campos();

    // Sin `autocomplete`, el navegador no ofrece guardar ni rellenar, y el
    // asesor acaba escribiendo la contraseña a mano veinte veces al día.
    expect(correo.getAttribute("autocomplete")).toBe("username");
    expect(contrasena.getAttribute("autocomplete")).toBe("current-password");
  });

  it("envía lo que el asesor escribió", async () => {
    mockLogin.mockResolvedValue(undefined);
    render(<LoginPage />);
    const { inmobiliaria, correo, contrasena, entrar } = campos();

    await userEvent.clear(inmobiliaria);
    await userEvent.type(inmobiliaria, "alfa-propiedades");
    await userEvent.type(correo, "asesor@alfa.co");
    await userEvent.type(contrasena, "secreta");
    await userEvent.click(entrar);

    expect(mockLogin).toHaveBeenCalledWith({
      tenantSlug: "alfa-propiedades",
      email: "asesor@alfa.co",
      password: "secreta",
    });
  });

  it("muestra el mensaje que devolvió la API, no uno inventado", async () => {
    mockLogin.mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "Credenciales inválidas"));
    render(<LoginPage />);

    await userEvent.type(campos().correo, "asesor@alfa.co");
    await userEvent.type(campos().contrasena, "mala");
    await userEvent.click(campos().entrar);

    /*
     * El mensaje de la API es deliberadamente el mismo para "no existe" y
     * "contraseña incorrecta": distinguirlos permitiría averiguar qué correos
     * están dados de alta. El panel no puede ser más "útil" que eso.
     */
    await waitFor(() => {
      expect(screen.getByText("Credenciales inválidas")).toBeDefined();
    });
  });

  it("si no hay servidor, lo dice en vez de quedarse callada", async () => {
    mockLogin.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<LoginPage />);

    await userEvent.type(campos().correo, "asesor@alfa.co");
    await userEvent.type(campos().contrasena, "x");
    await userEvent.click(campos().entrar);

    await waitFor(() => {
      expect(screen.getByText("No se pudo conectar con el servidor")).toBeDefined();
    });
  });

  it("no se puede enviar dos veces mientras está entrando", async () => {
    let resolver: (() => void) | undefined;
    mockLogin.mockReturnValue(
      new Promise<void>((resolve) => {
        resolver = resolve;
      }),
    );
    render(<LoginPage />);

    await userEvent.type(campos().correo, "asesor@alfa.co");
    await userEvent.type(campos().contrasena, "x");
    await userEvent.click(campos().entrar);

    // Un doble clic crearía dos sesiones para el mismo asesor.
    await waitFor(() => {
      expect(campos().entrar.hasAttribute("disabled")).toBe(true);
    });
    expect(screen.getByRole("button", { name: "Entrando…" })).toBeDefined();

    resolver?.();
  });

  it("tras un fallo se puede volver a intentar", async () => {
    mockLogin.mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "Credenciales inválidas"));
    render(<LoginPage />);

    await userEvent.type(campos().correo, "asesor@alfa.co");
    await userEvent.type(campos().contrasena, "mala");
    await userEvent.click(campos().entrar);

    await waitFor(() => {
      expect(screen.getByText("Credenciales inválidas")).toBeDefined();
    });
    // El botón vuelve a estar activo: dejarlo bloqueado obligaría a recargar.
    expect(campos().entrar.hasAttribute("disabled")).toBe(false);
  });
});

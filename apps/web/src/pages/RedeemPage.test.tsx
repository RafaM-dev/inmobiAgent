import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { RedeemPage } from "./RedeemPage";

/**
 * ELEGIR CONTRASEÑA CON UN ENLACE.
 *
 * Es la única pantalla del producto que se abre SIN sesión y que concede
 * acceso, así que lo que se comprueba es lo que la hace segura y usable a la
 * vez: que no se envíe nada a medias, que un enlace roto se explique en vez de
 * fallar al enviar, y que terminar NO abra sesión sola.
 */

const mockRedeem = vi.fn();
vi.mock("../api/backoffice", () => ({
  api: { redeemToken: (body: unknown) => mockRedeem(body) as unknown },
}));

const renderAt = (search: string, mode: "invitation" | "reset" = "invitation") =>
  render(
    <MemoryRouter initialEntries={[`/aceptar-invitacion${search}`]}>
      <RedeemPage mode={mode} />
    </MemoryRouter>,
  );

const VALID = "?token=un-token-suficientemente-largo-para-el-contrato&inmobiliaria=alfa";

describe("Elegir contraseña con un enlace", () => {
  beforeEach(() => {
    mockRedeem.mockReset();
    mockRedeem.mockResolvedValue({ tenantSlug: "alfa", email: "nueva@alfa.co" });
  });

  it("un enlace sin token se explica en vez de dejar probar", () => {
    renderAt("");

    expect(screen.getByText(/enlace está incompleto/i)).toBeDefined();
    // Y no hay formulario que enviar: no se puede fallar de otra manera.
    expect(screen.queryByLabelText("Contraseña")).toBeNull();
  });

  it("exige diez caracteres y dice cuántos faltan", async () => {
    renderAt(VALID);

    await userEvent.type(screen.getByLabelText("Contraseña"), "corta");

    expect(screen.getByText(/te faltan 5 caracteres/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /guardar/i })).toHaveProperty("disabled", true);
  });

  it("avisa si las dos no coinciden, antes de enviar", async () => {
    renderAt(VALID);

    await userEvent.type(screen.getByLabelText("Contraseña"), "contrasena-larga-2026");
    await userEvent.type(screen.getByLabelText("Repítela"), "contrasena-distinta");

    expect(screen.getByText(/no coinciden/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /guardar/i })).toHaveProperty("disabled", true);
  });

  it("envía el token del enlace, no algo que teclee el usuario", async () => {
    renderAt(VALID);

    await userEvent.type(screen.getByLabelText("Contraseña"), "contrasena-larga-2026");
    await userEvent.type(screen.getByLabelText("Repítela"), "contrasena-larga-2026");
    await userEvent.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => {
      expect(mockRedeem).toHaveBeenCalledWith({
        token: "un-token-suficientemente-largo-para-el-contrato",
        password: "contrasena-larga-2026",
      });
    });
  });

  it("al terminar NO entra solo: manda al acceso", async () => {
    /*
     * Entrar automáticamente sería cómodo y significaría que quien tenga el
     * enlace entra sin escribir nunca la contraseña — y ese enlace ha viajado
     * por correo.
     */
    renderAt(VALID);

    await userEvent.type(screen.getByLabelText("Contraseña"), "contrasena-larga-2026");
    await userEvent.type(screen.getByLabelText("Repítela"), "contrasena-larga-2026");
    await userEvent.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => {
      expect(screen.getByText(/contraseña guardada/i)).toBeDefined();
    });
    expect(screen.getByRole("button", { name: /ir al acceso/i })).toBeDefined();
    expect(screen.getByText("nueva@alfa.co")).toBeDefined();
  });

  it("un enlace caducado se explica tal y como lo dice el servidor", async () => {
    mockRedeem.mockRejectedValue(
      new ApiError(400, "VALIDATION", "Este enlace ya no es válido. Puede haber caducado."),
    );

    renderAt(VALID);
    await userEvent.type(screen.getByLabelText("Contraseña"), "contrasena-larga-2026");
    await userEvent.type(screen.getByLabelText("Repítela"), "contrasena-larga-2026");
    await userEvent.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => {
      expect(screen.getByText(/ya no es válido/i)).toBeDefined();
    });
  });

  it("el mismo formulario sirve para restablecer, con otro texto", () => {
    renderAt(VALID, "reset");

    expect(screen.getByText("Nueva contraseña")).toBeDefined();
    expect(screen.getByLabelText("Contraseña")).toBeDefined();
  });
});

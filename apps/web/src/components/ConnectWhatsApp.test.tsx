import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { ConnectWhatsApp } from "./ConnectWhatsApp";

/**
 * ALTA DE UN NÚMERO DE WHATSAPP.
 *
 * Es el único formulario del panel que maneja un secreto, así que lo que se
 * comprueba no es el diseño: que el token no se pueda leer de la pantalla, que
 * no se quede en el campo al cerrar, y —sobre todo— que un alta SIN CONFIRMAR
 * se vea. Ese último caso es el que convierte un token mal pegado en un agente
 * mudo que nadie sabe por qué no responde.
 */

const mockConnect = vi.fn();
vi.mock("../api/backoffice", () => ({
  api: {
    connectWhatsApp: (body: unknown) => mockConnect(body) as unknown,
  },
}));

const ACCOUNT = {
  id: "acc-1",
  channelType: "WHATSAPP" as const,
  externalId: "109876543210987",
  displayName: "Comercial Bogotá",
  isActive: true,
};

const abrir = async (): Promise<void> => {
  await userEvent.click(screen.getByRole("button", { name: "Conectar WhatsApp" }));
};

const rellenar = async (): Promise<void> => {
  await userEvent.type(screen.getByLabelText("Nombre de la línea"), "Comercial Bogotá");
  await userEvent.type(screen.getByLabelText("Identificador del número"), "109876543210987");
  await userEvent.type(screen.getByLabelText("Token de acceso"), "EAAG-token");
};

describe("Conectar WhatsApp", () => {
  beforeEach(() => {
    mockConnect.mockReset();
    mockConnect.mockResolvedValue({ account: ACCOUNT, verified: true });
  });

  it("el token no se puede leer de la pantalla", async () => {
    render(<ConnectWhatsApp onConnected={vi.fn()} />);
    await abrir();

    expect(screen.getByLabelText("Token de acceso")).toHaveProperty("type", "password");
  });

  it("no deja enviar hasta que están los tres datos", async () => {
    render(<ConnectWhatsApp onConnected={vi.fn()} />);
    await abrir();

    const conectar = screen.getByRole("button", { name: "Conectar" });
    expect(conectar).toHaveProperty("disabled", true);

    await rellenar();
    expect(conectar).toHaveProperty("disabled", false);
  });

  it("envía lo escrito y avisa a la pantalla para que se refresque", async () => {
    const onConnected = vi.fn();
    render(<ConnectWhatsApp onConnected={onConnected} />);
    await abrir();
    await rellenar();
    await userEvent.click(screen.getByRole("button", { name: "Conectar" }));

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledWith({
        displayName: "Comercial Bogotá",
        phoneNumberId: "109876543210987",
        accessToken: "EAAG-token",
      });
    });
    expect(onConnected).toHaveBeenCalledOnce();
  });

  it("un alta sin confirmar deja un aviso VISIBLE tras cerrarse el diálogo", async () => {
    /*
     * El caso que importa. El diálogo se cierra al conectar, así que si el
     * aviso viviera dentro se vería un instante y quien pegó un token
     * equivocado se quedaría creyendo que el número quedó funcionando.
     */
    mockConnect.mockResolvedValue({
      account: ACCOUNT,
      verified: false,
      verificationMessage: "Token no válido para este número",
    });

    render(<ConnectWhatsApp onConnected={vi.fn()} />);
    await abrir();
    await rellenar();
    await userEvent.click(screen.getByRole("button", { name: "Conectar" }));

    await waitFor(() => {
      expect(screen.getByText(/Token no válido para este número/)).toBeDefined();
    });
    // Y el diálogo ya no está: el aviso le sobrevive.
    expect(screen.queryByLabelText("Token de acceso")).toBeNull();
  });

  it("el token no se queda en el campo al cerrar y volver a abrir", async () => {
    render(<ConnectWhatsApp onConnected={vi.fn()} />);
    await abrir();
    await rellenar();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await abrir();
    expect(screen.getByLabelText("Token de acceso")).toHaveProperty("value", "");
  });

  it("el error del servidor se muestra tal cual, sin cerrar el formulario", async () => {
    // Lo escrito sigue ahí: quien se equivocó en un campo corrige ese campo, no
    // vuelve a teclear un token de doscientos caracteres.
    mockConnect.mockRejectedValue(
      new ApiError(409, "CONFLICT", "Este número ya está en uso por otra inmobiliaria"),
    );

    render(<ConnectWhatsApp onConnected={vi.fn()} />);
    await abrir();
    await rellenar();
    await userEvent.click(screen.getByRole("button", { name: "Conectar" }));

    await waitFor(() => {
      expect(screen.getByText(/ya está en uso por otra inmobiliaria/)).toBeDefined();
    });
    expect(screen.getByLabelText("Identificador del número")).toHaveProperty(
      "value",
      "109876543210987",
    );
  });
});

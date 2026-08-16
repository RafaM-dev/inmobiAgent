import type { LeadSummaryContract } from "@agentinmobi/contracts";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { LeadsPage } from "./LeadsPage";

/**
 * LA BANDEJA DE LEADS, QUE AHORA SE PUEDE TOCAR.
 *
 * Hasta hace poco esta pantalla solo miraba. Lo que se comprueba aquí es lo que
 * hace que mover el embudo desde el panel sea de fiar: que las opciones salgan
 * del servidor y no de una copia del embudo escrita en el navegador, que cerrar
 * un lead —que no tiene vuelta atrás— pase por una confirmación, y que la fila
 * refleje lo que respondió el servidor y no lo que el panel supuso.
 */

const mockLeads = vi.fn();
const mockTeam = vi.fn();
const mockChangeStatus = vi.fn();
const mockAssign = vi.fn();

vi.mock("../api/backoffice", () => ({
  api: {
    leads: (filters: unknown) => mockLeads(filters) as unknown,
    team: () => mockTeam() as unknown,
    changeLeadStatus: (leadId: string, body: unknown) =>
      mockChangeStatus(leadId, body) as unknown,
    assignLead: (leadId: string, body: unknown) => mockAssign(leadId, body) as unknown,
  },
}));

const lead = (overrides: Partial<LeadSummaryContract> = {}): LeadSummaryContract => ({
  id: "lead-1",
  contactId: "contact-1",
  conversationId: "conv-1",
  status: "NEW",
  score: 70,
  band: "HOT",
  interestCount: 3,
  lastActivityAt: "2026-08-16T15:00:00.000Z",
  allowedTransitions: ["CONTACTED", "QUALIFIED", "SCHEDULED", "LOST"],
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <LeadsPage />
    </MemoryRouter>,
  );

/** Abre un desplegable de la tabla y espera a que el menú esté disponible. */
const openSelect = async (name: string): Promise<HTMLElement> => {
  await userEvent.click(await screen.findByRole("combobox", { name }));
  return screen.findByRole("listbox");
};

describe("Bandeja de leads", () => {
  beforeEach(() => {
    mockLeads.mockReset().mockResolvedValue({ items: [lead()] });
    mockTeam
      .mockReset()
      .mockResolvedValue({
        canManage: true,
        items: [
          { id: "user-1", displayName: "María Restrepo", email: "maria@alfa.co", role: "AGENT", status: "ACTIVE" },
          { id: "user-2", displayName: "Se fue", email: "ex@alfa.co", role: "AGENT", status: "DISABLED" },
        ],
      });
    mockChangeStatus.mockReset();
    mockAssign.mockReset();
  });

  /*
   * La razón de que `allowedTransitions` viaje con cada lead. Si el panel se
   * supiera el embudo de memoria, esta prueba pasaría igual con la lista
   * completa — y el día que cambie la tabla de transiciones en el servidor,
   * nadie se enteraría hasta que un asesor recibiera un 409.
   */
  it("ofrece solo las transiciones que autoriza el servidor", async () => {
    mockLeads.mockResolvedValue({ items: [lead({ allowedTransitions: ["CONTACTED", "LOST"] })] });
    renderPage();

    const menu = await openSelect("Estado del lead");

    expect(within(menu).getByRole("option", { name: "Contactado" })).toBeDefined();
    expect(within(menu).getByRole("option", { name: "Perdido" })).toBeDefined();
    // No estaban en la lista del servidor: no se pintan aunque existan.
    expect(within(menu).queryByRole("option", { name: "Cualificado" })).toBeNull();
    expect(within(menu).queryByRole("option", { name: "Ganado" })).toBeNull();
  });

  it("un lead cerrado no ofrece desplegable, solo dice en qué acabó", async () => {
    mockLeads.mockResolvedValue({
      items: [lead({ status: "WON", allowedTransitions: [] })],
    });
    renderPage();

    expect(await screen.findByText("Ganado")).toBeDefined();
    expect(screen.queryByRole("combobox", { name: "Estado del lead" })).toBeNull();
  });

  it("un avance normal se aplica al momento y la fila muestra lo que devolvió el servidor", async () => {
    mockChangeStatus.mockResolvedValue(
      lead({ status: "CONTACTED", allowedTransitions: ["QUALIFIED", "SCHEDULED", "WON", "LOST"] }),
    );

    renderPage();
    const menu = await openSelect("Estado del lead");
    await userEvent.click(within(menu).getByRole("option", { name: "Contactado" }));

    await waitFor(() => {
      expect(mockChangeStatus).toHaveBeenCalledWith("lead-1", { status: "CONTACTED" });
    });
    // Y ahora ofrece "Ganado", que antes no estaba: la fila es la del servidor.
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Estado del lead" }).textContent).toContain(
        "Contactado",
      );
    });
  });

  /*
   * Cerrar un lead no tiene vuelta atrás —el agregado no ofrece ninguna
   * transición desde WON ni LOST—, así que no puede ocurrir por un clic suelto
   * en un desplegable.
   */
  it("marcar como perdido pide confirmación antes de tocar nada", async () => {
    renderPage();
    const menu = await openSelect("Estado del lead");
    await userEvent.click(within(menu).getByRole("option", { name: "Perdido" }));

    expect(await screen.findByText(/no tiene vuelta atrás/i)).toBeDefined();
    expect(mockChangeStatus).not.toHaveBeenCalled();
  });

  it("y manda el motivo que se escribe en la confirmación", async () => {
    mockChangeStatus.mockResolvedValue(lead({ status: "LOST", allowedTransitions: [] }));

    renderPage();
    const menu = await openSelect("Estado del lead");
    await userEvent.click(within(menu).getByRole("option", { name: "Perdido" }));

    await userEvent.type(
      await screen.findByLabelText(/motivo/i),
      "Se fue con la competencia",
    );
    await userEvent.click(screen.getByRole("button", { name: /marcar perdido/i }));

    await waitFor(() => {
      expect(mockChangeStatus).toHaveBeenCalledWith("lead-1", {
        status: "LOST",
        reason: "Se fue con la competencia",
      });
    });
  });

  it("solo se puede asignar a gente activa del equipo", async () => {
    renderPage();
    const menu = await openSelect("Asignar lead");

    expect(within(menu).getByRole("option", { name: "María Restrepo" })).toBeDefined();
    expect(within(menu).getByRole("option", { name: "Sin asignar" })).toBeDefined();
    // Desactivada: sigue en el equipo, pero no puede recibir trabajo.
    expect(within(menu).queryByRole("option", { name: "Se fue" })).toBeNull();
  });

  /*
   * `null` y no omitir el campo: el servidor distingue "quítaselo a quien lo
   * tenga" de "no toques la asignación", y el panel tiene que decir cuál es.
   */
  it("devolver un lead al montón manda userId nulo", async () => {
    mockLeads.mockResolvedValue({ items: [lead({ assignedUserId: "user-1" })] });
    mockAssign.mockResolvedValue(lead());

    renderPage();
    const menu = await openSelect("Asignar lead");
    await userEvent.click(within(menu).getByRole("option", { name: "Sin asignar" }));

    await waitFor(() => {
      expect(mockAssign).toHaveBeenCalledWith("lead-1", { userId: null });
    });
  });

  it("un rechazo del servidor se explica y la fila no se mueve", async () => {
    mockChangeStatus.mockRejectedValue(
      new ApiError(409, "CONFLICT", 'Este lead está en "LOST" y desde ahí no se puede pasar a "WON".'),
    );

    renderPage();
    const menu = await openSelect("Estado del lead");
    await userEvent.click(within(menu).getByRole("option", { name: "Contactado" }));

    expect(await screen.findByText(/no se puede pasar a/i)).toBeDefined();
    expect(screen.getByRole("combobox", { name: "Estado del lead" }).textContent).toContain(
      "Nuevo",
    );
  });

  it("sin equipo cargado la bandeja sigue sirviendo", async () => {
    // El equipo es un extra: si su llamada falla, mover el embudo —que es el
    // trabajo— tiene que seguir funcionando.
    mockTeam.mockRejectedValue(new ApiError(500, "INTERNAL", "vaya"));
    renderPage();

    expect(await screen.findByRole("combobox", { name: "Estado del lead" })).toBeDefined();
    expect(screen.queryByRole("combobox", { name: "Asignar lead" })).toBeNull();
    expect(screen.getByText("Sin asignar")).toBeDefined();
  });
});

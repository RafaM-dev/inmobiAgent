import type { AppointmentSummaryContract } from "@agentinmobi/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { AgendaPage } from "./AgendaPage";

/**
 * LA AGENDA, QUE AHORA SE PUEDE TOCAR.
 *
 * Confirmar y cancelar no se ofrecen desde cualquier estado, y esa lista no es
 * una preferencia de diseño: sale de la tabla de transiciones del agregado
 * `Appointment`. Lo que se comprueba aquí es que el panel no ofrezca lo que el
 * servidor va a rechazar, y que al actuar la fila se actualice con la respuesta
 * en vez de recargar la lista entera bajo el cursor de quien acaba de pulsar.
 */

const mockAppointments = vi.fn();
const mockConfirm = vi.fn();
const mockCancel = vi.fn();

vi.mock("../api/backoffice", () => ({
  api: {
    appointments: (filters: unknown) => mockAppointments(filters) as unknown,
    confirmAppointment: (id: string) => mockConfirm(id) as unknown,
    cancelAppointment: (id: string) => mockCancel(id) as unknown,
  },
}));

const visita = (
  overrides: Partial<AppointmentSummaryContract> = {},
): AppointmentSummaryContract => ({
  id: "cita-1",
  conversationId: "conv-1",
  contactId: "contact-1",
  status: "REQUESTED",
  scheduledAt: "2026-08-20T15:00:00.000Z",
  label: "jueves 20 de agosto, 10:00",
  durationMin: 45,
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <AgendaPage />
    </MemoryRouter>,
  );

describe("Agenda de visitas", () => {
  beforeEach(() => {
    mockAppointments.mockReset().mockResolvedValue({ items: [visita()] });
    mockConfirm.mockReset();
    mockCancel.mockReset();
  });

  it("una visita solicitada se puede confirmar y cancelar", async () => {
    renderPage();

    expect(await screen.findByRole("button", { name: /confirmar/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /^cancelar$/i })).toBeDefined();
  });

  /*
   * El agregado permite CONFIRMED → CANCELLED, pero no volver a confirmar. Un
   * botón que el servidor va a rechazar es peor que ningún botón: invita a
   * probar y después culpa al usuario.
   */
  it("una ya confirmada solo se puede cancelar", async () => {
    mockAppointments.mockResolvedValue({ items: [visita({ status: "CONFIRMED" })] });
    renderPage();

    expect(await screen.findByRole("button", { name: /^cancelar$/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /confirmar/i })).toBeNull();
  });

  it("una cancelada no ofrece ninguna de las dos", async () => {
    mockAppointments.mockResolvedValue({ items: [visita({ status: "CANCELLED" })] });
    renderPage();

    expect(await screen.findByText("Cancelada")).toBeDefined();
    expect(screen.queryByRole("button", { name: /confirmar/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^cancelar$/i })).toBeNull();
  });

  it("confirmar actualiza la fila con lo que respondió el servidor", async () => {
    mockConfirm.mockResolvedValue({
      id: "cita-1",
      status: "CONFIRMED",
      scheduledAt: "2026-08-20T15:00:00.000Z",
      label: "jueves 20 de agosto, 10:00",
    });

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /confirmar/i }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith("cita-1");
    });
    expect(await screen.findByText("Confirmada")).toBeDefined();
    // Y el botón de confirmar desaparece, porque ya no aplica.
    expect(screen.queryByRole("button", { name: /confirmar/i })).toBeNull();
    // Sin recargar: la lista se pidió una sola vez, al montar.
    expect(mockAppointments).toHaveBeenCalledTimes(1);
  });

  it("cancelar deja la visita cancelada", async () => {
    mockCancel.mockResolvedValue({
      id: "cita-1",
      status: "CANCELLED",
      scheduledAt: "2026-08-20T15:00:00.000Z",
      label: "jueves 20 de agosto, 10:00",
    });

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /^cancelar$/i }));

    expect(await screen.findByText("Cancelada")).toBeDefined();
  });

  it("un fallo del servidor se explica y la visita no cambia", async () => {
    mockConfirm.mockRejectedValue(new ApiError(404, "NOT_FOUND", "Cita no encontrada: cita-1"));

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /confirmar/i }));

    expect(await screen.findByText(/no encontrada/i)).toBeDefined();
    expect(screen.getByText("Solicitada")).toBeDefined();
  });

  it("la hora que se enseña es la etiqueta del servidor, no una fecha reinterpretada", async () => {
    /*
     * `scheduledAt` es UTC y el navegador de un asesor de viaje lo pintaría en
     * su huso. La etiqueta ya viene escrita en la zona de la inmobiliaria: es
     * la hora que se le dijo al cliente, y es la única que puede aparecer aquí.
     */
    renderPage();

    expect(await screen.findByText("jueves 20 de agosto, 10:00")).toBeDefined();
  });
});

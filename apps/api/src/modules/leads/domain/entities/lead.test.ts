import { describe, expect, it } from "vitest";
import { DomainError } from "../../../../platform/errors/app-error";
import { LeadBand } from "../value-objects/lead-score";
import { Lead, LeadStatus } from "./lead";

const NOW = new Date("2026-08-06T15:00:00Z");
const LATER = new Date("2026-08-06T16:00:00Z");

const newLead = (): Lead =>
  Lead.capture({
    id: "lead-1",
    tenantId: "tenant-1",
    contactId: "contact-1",
    conversationId: "conv-1",
    source: "CONSOLE",
    now: NOW,
  });

describe("Lead — la ficha comercial", () => {
  it("nace en NUEVO, sin puntuar y con su primer registro de historial", () => {
    const lead = newLead();

    expect(lead.status).toBe(LeadStatus.NEW);
    expect(lead.score.value).toBe(0);
    expect(lead.isOpen).toBe(true);
    expect(lead.pullHistory().map((entry) => entry.type)).toEqual(["captured"]);
  });

  it("el historial se extrae una sola vez: es lo que impide duplicarlo al guardar", () => {
    const lead = newLead();

    expect(lead.pullHistory()).toHaveLength(1);
    expect(lead.pullHistory()).toHaveLength(0);
  });

  it("mostrar dos veces el mismo inmueble no crea dos intereses, pero sí cuenta", () => {
    const lead = newLead();

    lead.registerInterest("mock:apa-0001", NOW);
    lead.registerInterest("mock:apa-0001", LATER);
    lead.registerInterest("mock:cas-0002", LATER);

    expect(lead.interests).toHaveLength(2);
    expect(lead.interests[0]?.timesShown).toBe(2);
    expect(lead.interests[0]?.firstShownAt).toEqual(NOW);
    expect(lead.interests[0]?.lastShownAt).toEqual(LATER);
    expect(lead.repeatedViews).toBe(1);
  });

  it("un interés nuevo deja rastro; volver a verlo no ensucia el historial", () => {
    const lead = newLead();
    lead.pullHistory();

    lead.registerInterest("mock:apa-0001", NOW);
    lead.registerInterest("mock:apa-0001", LATER);

    expect(lead.pullHistory().map((entry) => entry.type)).toEqual(["interest_added"]);
  });

  it("los requisitos se completan, no se sustituyen", () => {
    const lead = newLead();

    lead.updateRequirements({ city: "Medellín", operation: "RENT" }, NOW);
    const changed = lead.updateRequirements({ bedroomsMin: 2 }, LATER);

    expect(changed).toBe(true);
    expect(lead.requirements).toEqual({ city: "Medellín", operation: "RENT", bedroomsMin: 2 });
  });

  it("repetir los mismos requisitos no cuenta como cambio", () => {
    const lead = newLead();
    lead.updateRequirements({ city: "Medellín" }, NOW);

    expect(lead.updateRequirements({ city: "Medellín" }, LATER)).toBe(false);
  });

  it("recorre el embudo hacia delante", () => {
    const lead = newLead();

    expect(lead.changeStatus(LeadStatus.QUALIFIED, NOW)).toBe(true);
    expect(lead.changeStatus(LeadStatus.SCHEDULED, LATER)).toBe(true);
    expect(lead.status).toBe(LeadStatus.SCHEDULED);
  });

  it("no permite retroceder en el embudo: eso es un bug, no un caso de negocio", () => {
    const lead = newLead();
    lead.changeStatus(LeadStatus.QUALIFIED, NOW);

    expect(() => lead.changeStatus(LeadStatus.NEW, LATER)).toThrow(DomainError);
  });

  it("un lead cerrado no revive", () => {
    const lead = newLead();
    lead.changeStatus(LeadStatus.LOST, NOW, "sin respuesta");

    expect(lead.isOpen).toBe(false);
    expect(() => lead.changeStatus(LeadStatus.QUALIFIED, LATER)).toThrow(DomainError);
  });

  it("se puede perder desde cualquier estado abierto", () => {
    for (const status of [LeadStatus.CONTACTED, LeadStatus.QUALIFIED, LeadStatus.SCHEDULED]) {
      const lead = newLead();
      lead.changeStatus(status, NOW);
      expect(lead.changeStatus(LeadStatus.LOST, LATER)).toBe(true);
    }
  });

  it("marcar la visita pedida es idempotente", () => {
    const lead = newLead();
    lead.pullHistory();

    lead.markVisitRequested(NOW);
    lead.markVisitRequested(LATER);

    expect(lead.visitRequested).toBe(true);
    expect(lead.pullHistory()).toHaveLength(1);
  });

  it("aplicar la misma puntuación no genera ruido en el historial", () => {
    const lead = newLead();
    const score = { value: 45, band: LeadBand.WARM, reasons: [] };
    lead.pullHistory();

    expect(lead.applyScore(score, NOW)).toBe(true);
    expect(lead.applyScore(score, LATER)).toBe(false);
    expect(lead.pullHistory()).toHaveLength(1);
  });

  it("asignar al mismo asesor dos veces no cambia nada", () => {
    const lead = newLead();

    expect(lead.assignTo("user-1", NOW)).toBe(true);
    expect(lead.assignTo("user-1", LATER)).toBe(false);
    expect(lead.assignedUserId).toBe("user-1");
  });
});

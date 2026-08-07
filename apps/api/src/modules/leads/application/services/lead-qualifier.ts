import type { Clock } from "../../../../platform/clock/clock";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import type { AdvisorDirectory } from "../../../identity";
import { LeadStatus, type Lead } from "../../domain/entities/lead";
import { chooseAssignee } from "../../domain/policies/assignment.policy";
import { scoreLead } from "../../domain/policies/lead-scoring.policy";
import type { LeadRepository } from "../../domain/repositories/lead.repository";
import { LeadBand, BAND_RANK } from "../../domain/value-objects/lead-score";
import { LeadAssigned, LeadQualified, LeadStatusChanged } from "../events/leads.events";

export interface QualificationInput {
  readonly hasName: boolean;
  readonly contactMessages: number;
}

/**
 * `QualifyLead` (docs §6) — puntuar, promover y asignar.
 *
 * Está como servicio de aplicación y no como caso de uso suelto porque nunca
 * ocurre solo: se cualifica al capturar y al registrar interés, siempre dentro
 * de la transacción de quien lo llama. Un `QualifyLeadUseCase` independiente
 * obligaría a releer y volver a guardar el agregado que el llamante ya tiene
 * abierto, y abriría la puerta a puntuar sobre datos rancios.
 *
 * NO guarda. Muta el agregado y publica los eventos; el llamante decide cuándo
 * persiste. Así, puntuación, cambio de estado, asignación y eventos caen todos
 * en la misma unidad de trabajo.
 */
export class LeadQualifier {
  constructor(
    private readonly deps: {
      leads: LeadRepository;
      advisors: AdvisorDirectory;
      events: EventPublisher;
      clock: Clock;
    },
  ) {}

  async qualify(lead: Lead, input: QualificationInput): Promise<void> {
    const now = this.deps.clock.now();

    const score = scoreLead({
      requirements: lead.requirements,
      distinctPropertiesShown: lead.interests.length,
      repeatedViews: lead.repeatedViews,
      requestedVisit: lead.visitRequested,
      hasName: input.hasName,
      contactMessages: input.contactMessages,
    });

    const previousBand = lead.score.band;
    const changed = lead.applyScore(score, now);

    // Un lead tibio ya merece que alguien lo trabaje. Esperar a "caliente" es
    // esperar a que el cliente se canse.
    const worthQualifying = BAND_RANK[score.band] >= BAND_RANK[LeadBand.WARM];
    const promotable = lead.status === LeadStatus.NEW || lead.status === LeadStatus.CONTACTED;

    if (worthQualifying && promotable) {
      const from = lead.status;
      lead.changeStatus(LeadStatus.QUALIFIED, now);
      await this.deps.events.publish(LeadStatusChanged, {
        leadId: lead.id,
        conversationId: lead.conversationId,
        from,
        to: LeadStatus.QUALIFIED,
        reason: "scoring",
      });
    }

    // Se anuncia la cualificación cuando SUBE de banda, no en cada mensaje: un
    // asesor no necesita una notificación por cada palabra que escribe el
    // cliente, pero sí saber que un lead pasó de tibio a caliente.
    if (changed && BAND_RANK[score.band] > BAND_RANK[previousBand] && worthQualifying) {
      await this.deps.events.publish(LeadQualified, {
        leadId: lead.id,
        conversationId: lead.conversationId,
        score: score.value,
        band: score.band,
        reasons: score.reasons.map((reason) => reason.code),
      });
    }

    if (worthQualifying && lead.assignedUserId === undefined) {
      await this.assign(lead, now);
    }
  }

  /**
   * Reparto por carga entre quien puede recibir conversaciones. Si la
   * inmobiliaria todavía no tiene asesores dados de alta, el lead se queda sin
   * asignar: es un dato correcto, no un fallo, y el back-office lo mostrará
   * como "sin asignar" en vez de inventarse un responsable.
   */
  private async assign(lead: Lead, now: Date): Promise<void> {
    const advisors = await this.deps.advisors.listAssignable();
    if (advisors.length === 0) return;

    const load = await this.deps.leads.countOpenByAssignee();
    const chosen = chooseAssignee(
      advisors.map((advisor) => ({ userId: advisor.id, openLeads: load[advisor.id] ?? 0 })),
    );
    if (!chosen) return;

    if (lead.assignTo(chosen, now)) {
      await this.deps.events.publish(LeadAssigned, {
        leadId: lead.id,
        conversationId: lead.conversationId,
        userId: chosen,
        score: lead.score.value,
      });
    }
  }
}

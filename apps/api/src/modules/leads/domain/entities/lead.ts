import { DomainError } from "../../../../platform/errors/app-error";
import {
  newInterest,
  touchInterest,
  type LeadInterest,
} from "../value-objects/lead-interest";
import {
  mergeRequirements,
  type LeadRequirements,
} from "../value-objects/lead-requirements";
import { emptyScore, type LeadScore } from "../value-objects/lead-score";

/**
 * Estado comercial del lead. El orden NO es decorativo: es un embudo, y
 * retroceder en un embudo casi siempre es un error de programación.
 */
export const LeadStatus = {
  NEW: "NEW",
  CONTACTED: "CONTACTED",
  QUALIFIED: "QUALIFIED",
  SCHEDULED: "SCHEDULED",
  WON: "WON",
  LOST: "LOST",
} as const;
export type LeadStatus = (typeof LeadStatus)[keyof typeof LeadStatus];

/**
 * Transiciones permitidas. Explícitas y en una tabla porque una máquina de
 * estados escrita a base de `if` es una máquina de estados que nadie audita.
 *
 * `LOST` se alcanza desde cualquier estado abierto: un cliente puede
 * desaparecer en cualquier momento, y eso es información, no un fallo.
 */
const TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  NEW: ["CONTACTED", "QUALIFIED", "SCHEDULED", "LOST"],
  CONTACTED: ["QUALIFIED", "SCHEDULED", "WON", "LOST"],
  QUALIFIED: ["SCHEDULED", "WON", "LOST"],
  SCHEDULED: ["QUALIFIED", "WON", "LOST"],
  // Estados terminales: reabrir un lead es crear uno nuevo, no revivir éste.
  WON: [],
  LOST: [],
};

export interface LeadConsent {
  readonly dataProcessing: boolean;
  readonly marketing: boolean;
  readonly grantedAt?: Date;
}

/** Entrada del histórico append-only (`lead_events`). */
export interface LeadHistoryEntry {
  readonly type: string;
  readonly at: Date;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface LeadProps {
  readonly id: string;
  readonly tenantId: string;
  readonly contactId: string;
  readonly conversationId: string;
  /** Canal por el que entró. Cadena opaca: `leads` no interpreta canales. */
  readonly source: string;
  readonly status: LeadStatus;
  readonly requirements: LeadRequirements;
  readonly interests: readonly LeadInterest[];
  readonly score: LeadScore;
  readonly assignedUserId?: string;
  readonly consent: LeadConsent;
  /** El cliente pidió visitar algo. Señal fuerte para el scoring. */
  readonly visitRequested: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly lastActivityAt: Date;
}

/**
 * AGREGADO `Lead` — la ficha comercial de un cliente potencial.
 *
 * Es el punto donde una conversación deja de ser un chat y se convierte en algo
 * que la inmobiliaria puede trabajar. Por eso vive fuera de `conversation`: una
 * conversación se cierra, un lead se sigue trabajando meses.
 *
 * Todos los cambios de estado devuelven historial en vez de mutarlo en silencio:
 * `pullHistory()` lo entrega al repositorio, que lo escribe en la MISMA
 * transacción que el lead. Un cambio de estado sin su rastro no puede existir.
 */
export class Lead {
  private history: LeadHistoryEntry[] = [];

  private constructor(private props: LeadProps) {}

  static capture(input: {
    id: string;
    tenantId: string;
    contactId: string;
    conversationId: string;
    source: string;
    requirements?: LeadRequirements;
    consent?: LeadConsent;
    now: Date;
  }): Lead {
    const lead = new Lead({
      id: input.id,
      tenantId: input.tenantId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      source: input.source,
      status: LeadStatus.NEW,
      requirements: input.requirements ?? {},
      interests: [],
      score: emptyScore(),
      consent: input.consent ?? { dataProcessing: true, marketing: false },
      visitRequested: false,
      createdAt: input.now,
      updatedAt: input.now,
      lastActivityAt: input.now,
    });

    lead.record("captured", input.now, { source: input.source });
    return lead;
  }

  static rehydrate(props: LeadProps): Lead {
    return new Lead(props);
  }

  get id(): string {
    return this.props.id;
  }
  get tenantId(): string {
    return this.props.tenantId;
  }
  get contactId(): string {
    return this.props.contactId;
  }
  get conversationId(): string {
    return this.props.conversationId;
  }
  get status(): LeadStatus {
    return this.props.status;
  }
  get requirements(): LeadRequirements {
    return this.props.requirements;
  }
  get interests(): readonly LeadInterest[] {
    return this.props.interests;
  }
  get score(): LeadScore {
    return this.props.score;
  }
  get assignedUserId(): string | undefined {
    return this.props.assignedUserId;
  }
  get visitRequested(): boolean {
    return this.props.visitRequested;
  }
  get isOpen(): boolean {
    return this.props.status !== LeadStatus.WON && this.props.status !== LeadStatus.LOST;
  }

  /** Interés repetido: veces que se volvió a mostrar algo ya visto. */
  get repeatedViews(): number {
    return this.props.interests.reduce(
      (sum, interest) => sum + Math.max(0, interest.timesShown - 1),
      0,
    );
  }

  /**
   * Actualiza lo que el cliente busca. Devuelve `true` si algo cambió: quien
   * llama decide si eso merece recalcular la puntuación o publicar un evento.
   */
  updateRequirements(incoming: LeadRequirements, now: Date): boolean {
    const merged = mergeRequirements(this.props.requirements, incoming);
    if (JSON.stringify(merged) === JSON.stringify(this.props.requirements)) return false;

    this.props = { ...this.props, requirements: merged, updatedAt: now, lastActivityAt: now };
    this.record("requirements_updated", now, { requirements: merged });
    return true;
  }

  /** Deja constancia de que se le mostró un inmueble. Idempotente por referencia. */
  registerInterest(propertyRef: string, at: Date): void {
    const existing = this.props.interests.find((interest) => interest.propertyRef === propertyRef);

    const interests = existing
      ? this.props.interests.map((interest) =>
          interest.propertyRef === propertyRef ? touchInterest(interest, at) : interest,
        )
      : [...this.props.interests, newInterest(propertyRef, at)];

    this.props = { ...this.props, interests, updatedAt: at, lastActivityAt: at };

    if (!existing) this.record("interest_added", at, { propertyRef });
  }

  markVisitRequested(now: Date): void {
    if (this.props.visitRequested) return;
    this.props = { ...this.props, visitRequested: true, updatedAt: now, lastActivityAt: now };
    this.record("visit_requested", now, {});
  }

  /** Aplica una puntuación ya calculada. La política vive fuera del agregado. */
  applyScore(score: LeadScore, now: Date): boolean {
    if (score.value === this.props.score.value && score.band === this.props.score.band) {
      return false;
    }
    const previous = this.props.score;
    this.props = { ...this.props, score, updatedAt: now };
    this.record("scored", now, {
      from: previous.value,
      to: score.value,
      band: score.band,
    });
    return true;
  }

  assignTo(userId: string, now: Date): boolean {
    if (this.props.assignedUserId === userId) return false;
    this.props = { ...this.props, assignedUserId: userId, updatedAt: now };
    this.record("assigned", now, { userId });
    return true;
  }

  grantConsent(consent: LeadConsent, now: Date): void {
    this.props = { ...this.props, consent: { ...consent, grantedAt: now }, updatedAt: now };
    this.record("consent_granted", now, {
      dataProcessing: consent.dataProcessing,
      marketing: consent.marketing,
    });
  }

  /**
   * Cambio de estado. Falla ruidosamente ante una transición imposible: eso es
   * un bug del llamante, no un caso de negocio que el agente deba explicar.
   */
  changeStatus(next: LeadStatus, now: Date, reason?: string): boolean {
    if (next === this.props.status) return false;

    if (!TRANSITIONS[this.props.status].includes(next)) {
      throw new DomainError(`Un lead no puede pasar de ${this.props.status} a ${next}`, {
        leadId: this.props.id,
        from: this.props.status,
        to: next,
      });
    }

    const from = this.props.status;
    this.props = { ...this.props, status: next, updatedAt: now, lastActivityAt: now };
    this.record("status_changed", now, { from, to: next, ...(reason ? { reason } : {}) });
    return true;
  }

  /** Historial acumulado desde la última extracción. Lo consume el repositorio. */
  pullHistory(): LeadHistoryEntry[] {
    const entries = this.history;
    this.history = [];
    return entries;
  }

  snapshot(): LeadProps {
    return { ...this.props, interests: [...this.props.interests] };
  }

  private record(type: string, at: Date, payload: Readonly<Record<string, unknown>>): void {
    this.history.push({ type, at, payload });
  }
}

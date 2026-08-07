import type { Lead, LeadStatus } from "../entities/lead";
import type { LeadBand } from "../value-objects/lead-score";

export interface LeadListFilter {
  readonly status?: LeadStatus;
  readonly band?: LeadBand;
  readonly assignedUserId?: string;
  readonly limit: number;
  /** Desplazamiento simple: la bandeja del back-office se pagina por páginas. */
  readonly offset?: number;
}

/** Proyección de lectura: la bandeja no necesita hidratar agregados enteros. */
export interface LeadSummary {
  readonly id: string;
  readonly contactId: string;
  readonly conversationId: string;
  readonly status: LeadStatus;
  readonly score: number;
  readonly band: LeadBand;
  readonly assignedUserId?: string;
  readonly interestCount: number;
  readonly lastActivityAt: Date;
}

export interface LeadRepository {
  findById(id: string): Promise<Lead | null>;
  /**
   * Clave de idempotencia de la captura: una conversación produce como mucho un
   * lead abierto, aunque el agente llame diez veces a `register_lead`.
   */
  findByConversation(conversationId: string): Promise<Lead | null>;
  /** Persiste el agregado y su historial pendiente en una sola transacción. */
  save(lead: Lead): Promise<void>;
  list(filter: LeadListFilter): Promise<readonly LeadSummary[]>;
  /** Leads abiertos por asesor. Es lo que alimenta el reparto por carga. */
  countOpenByAssignee(): Promise<Readonly<Record<string, number>>>;
}

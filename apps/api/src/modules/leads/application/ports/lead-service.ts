import type { AppError } from "../../../../platform/errors/app-error";
import type { Result } from "../../../../platform/result/result";
import type { LeadStatus } from "../../domain/entities/lead";
import type { LeadBand } from "../../domain/value-objects/lead-score";
import type { LeadRequirements } from "../../domain/value-objects/lead-requirements";

/**
 * PUERTO PÚBLICO de `leads` (docs §8.2, `LeadService`).
 *
 * Es lo que el agente conoce como herramienta y lo que el back-office usará en
 * F7. Fíjate en lo que NO expone: ni el agregado, ni el repositorio, ni la
 * política de scoring. Quien lo consume no puede dejar un lead en un estado
 * imposible aunque se equivoque.
 *
 * El día que `leads` sea un servicio aparte, esta interfaz se implementa con un
 * cliente HTTP y no cambia nada más.
 */

export interface LeadView {
  readonly id: string;
  readonly status: LeadStatus;
  readonly score: number;
  readonly band: LeadBand;
  readonly assignedUserId?: string;
  readonly interestCount: number;
  /** `true` si el lead se creó en esta llamada. La captura es idempotente. */
  readonly created: boolean;
}

export interface CaptureLeadCommand {
  readonly conversationId: string;
  readonly contactId: string;
  readonly requirements?: LeadRequirements;
  readonly consent?: { dataProcessing: boolean; marketing: boolean };
  /** El cliente pidió ver algo: la señal comercial que más pesa. */
  readonly visitRequested?: boolean;
}

export interface LeadService {
  /** Idempotente por conversación: llamarla dos veces devuelve el mismo lead. */
  capture(command: CaptureLeadCommand): Promise<Result<LeadView, AppError>>;
  /** El lead abierto de una conversación, si existe. */
  findByConversation(conversationId: string): Promise<Result<LeadView | null, AppError>>;
  /** Marca el embudo cuando se agenda una visita. Lo usa `appointments`. */
  markScheduled(conversationId: string): Promise<Result<void, AppError>>;
}

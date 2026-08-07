import type { Appointment } from "../entities/appointment";

export interface AppointmentRepository {
  findById(id: string): Promise<Appointment | null>;
  /** La cita viva de una conversación, si la hay. Evita agendar dos veces. */
  findActiveByConversation(conversationId: string): Promise<Appointment | null>;
  save(appointment: Appointment): Promise<void>;
  /** Citas que ocupan agenda en un rango. Es lo que consulta el calendario. */
  listActiveBetween(from: Date, to: Date, assignedUserId?: string): Promise<Appointment[]>;
  /**
   * Citas que empiezan antes de `before`, siguen vivas y no han recibido aviso.
   * Es la consulta del job de recordatorios.
   */
  listPendingReminders(before: Date, now: Date, limit: number): Promise<Appointment[]>;
  /**
   * Inmobiliarias con recordatorios pendientes.
   *
   * ES LA ÚNICA CONSULTA DEL MÓDULO SIN ÁMBITO DE TENANT, y por eso devuelve
   * solo identificadores: un job periódico tiene que saber a quién visitar antes
   * de poder entrar en el contexto de nadie. Ni un dato de negocio cruza por
   * aquí, así que no hay nada que filtrar entre inmobiliarias.
   */
  listTenantsWithPendingReminders(before: Date, now: Date): Promise<string[]>;
}

/**
 * Agrupador de turnos (docs §7.2).
 *
 * El problema real: por WhatsApp la gente escribe "hola" / "busco apto" / "en
 * Medellín" en tres mensajes seguidos. Responder tres veces es una pésima
 * experiencia y triplica el coste de tokens. El planificador espera un silencio
 * corto y entrega un solo turno.
 *
 * Es un puerto y no una clase concreta porque la implementación cambiará: hoy
 * temporizadores en memoria, mañana pg-boss con reintentos y varias réplicas
 * (decisión D2). Los casos de uso no se enteran.
 */
export interface ScheduleTurnCommand {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly correlationId: string;
}

export interface TurnScheduler {
  /**
   * Registra actividad en la conversación. Reinicia la espera de silencio; si
   * se alcanza el máximo, el turno se dispara aunque el cliente siga escribiendo.
   */
  schedule(command: ScheduleTurnCommand): void;

  /** Cancela lo pendiente (el asesor tomó el control, se cerró la conversación). */
  cancel(conversationId: string): void;

  /** Dispara ya lo pendiente. Lo usan los tests y el apagado ordenado. */
  flush(conversationId: string): Promise<void>;

  /** Vacía todo lo pendiente. Se llama al apagar para no perder turnos. */
  flushAll(): Promise<void>;
}

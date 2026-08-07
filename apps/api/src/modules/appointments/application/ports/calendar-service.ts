import type { TimeSlot } from "../../domain/value-objects/time-slot";

/**
 * PUERTO `CalendarService` (docs §5.6) — qué huecos están ocupados.
 *
 * Existe para que el día que una inmobiliaria quiera sincronizar con Google
 * Calendar u Outlook, se escriba un adaptador y no se toque ni la política de
 * horarios ni el caso de uso que propone franjas.
 *
 * Hoy el único adaptador es interno y mira las citas ya agendadas. **No hay
 * adaptador HTTP y eso es una decisión, no un olvido**: no conocemos la API de
 * ningún calendario concreto, y escribir uno "genérico" hoy sería inventarse
 * autenticación, formatos y semántica de eventos recurrentes.
 */
export interface CalendarService {
  /** Identificador del origen. Opaco, para trazas. */
  readonly source: string;

  /**
   * Huecos ocupados en el rango. Si no se indica asesor, se devuelven los de
   * toda la inmobiliaria: sin agenda por persona, dos visitas a la misma hora
   * son dos visitas que alguien tendrá que atender a la vez.
   */
  busyIntervals(input: {
    from: Date;
    to: Date;
    advisorId?: string;
  }): Promise<readonly TimeSlot[]>;
}

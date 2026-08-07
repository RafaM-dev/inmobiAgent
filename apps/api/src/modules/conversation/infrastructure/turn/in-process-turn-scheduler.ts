import type { Clock } from "../../../../platform/clock/clock";
import type { Logger } from "../../../../platform/logging/logger";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import type { ScheduleTurnCommand, TurnScheduler } from "../../application/ports/turn-scheduler";

interface PendingTurn {
  readonly command: ScheduleTurnCommand;
  /** Momento del primer mensaje del turno: fija el tope máximo de espera. */
  readonly firstScheduledAtMs: number;
  timer: NodeJS.Timeout;
}

export interface InProcessTurnSchedulerOptions {
  /** Silencio necesario para dar el turno por cerrado. */
  readonly debounceMs: number;
  /** Espera máxima aunque el cliente siga escribiendo. */
  readonly maxWaitMs: number;
}

/**
 * Agrupador de turnos con temporizadores en memoria (docs §7.2).
 *
 * Dos relojes, no uno: el de silencio se reinicia con cada mensaje, pero el
 * tope máximo no. Sin el tope, alguien que escribe sin parar nunca recibiría
 * respuesta; sin el silencio, se respondería a "hola" antes de leer "busco
 * apto en Medellín".
 *
 * LÍMITE CONOCIDO: si el proceso muere con turnos pendientes, esos turnos se
 * pierden (los mensajes NO: siguen en la base con `turn_id` nulo y el siguiente
 * mensaje del cliente los arrastra). En F2 esto pasa a pg-boss, que sobrevive a
 * reinicios y a varias réplicas — por eso `TurnScheduler` es un puerto y esta
 * clase, un detalle sustituible.
 */
export class InProcessTurnScheduler implements TurnScheduler {
  private readonly pending = new Map<string, PendingTurn>();
  /** Turnos en vuelo: evita solapar dos ejecuciones de la misma conversación. */
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly deps: {
      runTurn: (command: ScheduleTurnCommand) => Promise<void>;
      clock: Clock;
      logger: Logger;
      options: InProcessTurnSchedulerOptions;
    },
  ) {}

  schedule(command: ScheduleTurnCommand): void {
    const existing = this.pending.get(command.conversationId);
    if (existing) clearTimeout(existing.timer);

    const firstScheduledAtMs = existing?.firstScheduledAtMs ?? this.deps.clock.nowMs();
    const elapsed = this.deps.clock.nowMs() - firstScheduledAtMs;
    const remainingBudget = Math.max(0, this.deps.options.maxWaitMs - elapsed);
    const delay = Math.min(this.deps.options.debounceMs, remainingBudget);

    const timer = setTimeout(() => {
      void this.fire(command.conversationId);
    }, delay);
    // Un turno pendiente no debe impedir que el proceso termine al apagarse.
    timer.unref();

    this.pending.set(command.conversationId, { command, firstScheduledAtMs, timer });
  }

  cancel(conversationId: string): void {
    const existing = this.pending.get(conversationId);
    if (!existing) return;
    clearTimeout(existing.timer);
    this.pending.delete(conversationId);
  }

  async flush(conversationId: string): Promise<void> {
    await this.fire(conversationId);
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((id) => this.fire(id)));
    await Promise.all([...this.running.values()]);
  }

  private async fire(conversationId: string): Promise<void> {
    const pending = this.pending.get(conversationId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(conversationId);

    // Si ya hay un turno corriendo para esta conversación, se espera: el
    // candado de Postgres también lo protege, pero encadenar aquí evita el
    // viaje a la base y hace la ejecución local determinista.
    const previous = this.running.get(conversationId) ?? Promise.resolve();

    const execution = previous
      .then(() =>
        TenantContext.run(
          {
            tenantId: pending.command.tenantId,
            correlationId: pending.command.correlationId,
            conversationId,
            source: "job",
          },
          () => this.deps.runTurn(pending.command),
        ),
      )
      .catch((error: unknown) => {
        this.deps.logger.error("Fallo al ejecutar el turno", {
          conversationId,
          err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        });
      })
      .finally(() => {
        if (this.running.get(conversationId) === execution) {
          this.running.delete(conversationId);
        }
      });

    this.running.set(conversationId, execution);
    await execution;
  }
}

import type { Clock } from "../../../../platform/clock/clock";
import type { Logger } from "../../../../platform/logging/logger";
import type { AppointmentRepository } from "../../domain/repositories/appointment.repository";
import type { ScanDueRemindersUseCase } from "../../application/use-cases/scan-due-reminders.use-case";
import { SCHEDULING } from "../../application/services/scheduling-settings";

/**
 * Planificador de recordatorios en proceso.
 *
 * Mismo enfoque —y mismo límite conocido— que el agrupador de turnos de F1: un
 * temporizador en memoria. Si el proceso muere, la pasada se pierde; los datos
 * no, porque `reminderSentAt` vive en la base y la siguiente pasada recoge lo
 * que quedó pendiente. Con varias réplicas se enviaría el recordatorio dos
 * veces, y eso se resuelve en F9 sustituyendo esta clase por pg-boss: el caso
 * de uso no se entera porque no depende de ella.
 *
 * Recorre inmobiliaria por inmobiliaria en vez de barrer la tabla entera: los
 * repositorios exigen `TenantContext`, y ese requisito es lo que hace imposible
 * que un job mande el recordatorio de una agencia al cliente de otra.
 */
export class InProcessReminderScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly deps: {
      scan: ScanDueRemindersUseCase;
      appointments: AppointmentRepository;
      clock: Clock;
      logger: Logger;
      intervalMs?: number;
    },
  ) {}

  start(): void {
    if (this.timer) return;

    const interval = this.deps.intervalMs ?? 60_000;
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
    // Un temporizador de fondo no debe impedir que el proceso termine.
    this.timer.unref();

    this.deps.logger.debug("Planificador de recordatorios iniciado", { intervalMs: interval });
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Expuesta para poder forzar una pasada en tests y en scripts. */
  async tick(): Promise<number> {
    // Una pasada lenta no debe solaparse con la siguiente.
    if (this.running) return 0;
    this.running = true;

    try {
      const now = this.deps.clock.now();
      const until = new Date(now.getTime() + SCHEDULING.reminderHours * 3_600_000);
      const tenants = await this.deps.appointments.listTenantsWithPendingReminders(until, now);

      let total = 0;
      for (const tenantId of tenants) {
        total += await this.deps.scan.runFor(tenantId);
      }
      return total;
    } catch (error) {
      // Un fallo del job no puede tumbar el proceso que está atendiendo clientes.
      this.deps.logger.error("Fallo la pasada de recordatorios", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    } finally {
      this.running = false;
    }
  }
}

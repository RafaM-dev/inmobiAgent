import type { Clock } from "../../../../platform/clock/clock";
import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type AppError,
} from "../../../../platform/errors/app-error";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import { err, ok, type Result } from "../../../../platform/result/result";
import type { AdvisorDirectory } from "../../../identity";
import { allowedTransitions, canTransition, type Lead, type LeadStatus } from "../../domain/entities/lead";
import type { LeadRepository, LeadSummary } from "../../domain/repositories/lead.repository";
import { LeadAssigned, LeadStatusChanged } from "../events/leads.events";

/**
 * Lo que un asesor hace con un lead desde el panel: moverlo por el embudo y
 * decidir quién lo lleva.
 *
 * Hasta ahora el embudo solo lo movía el agente —`MarkLeadScheduled` cuando se
 * agendaba una visita—, así que un lead que se ganaba por teléfono se quedaba
 * eternamente en `QUALIFIED`. La bandeja ordena por puntuación, de modo que un
 * lead cerrado y no marcado sigue apareciendo arriba: el asesor pierde tiempo
 * en él, o aprende a desconfiar del orden. Las dos cosas son peores que no
 * tener la pantalla.
 *
 * **Por qué la validación se repite aquí y en el agregado.** `Lead.changeStatus`
 * LANZA ante una transición imposible, y hace bien: para él, quien llama es
 * código y una transición imposible es un bug. Pero por esta puerta entra una
 * persona con un panel que puede llevar abierto media hora, y en ese rato otro
 * compañero pudo mover el mismo lead. Eso no es un bug: es una carrera normal
 * entre dos humanos, y merece un 409 que el panel sabe explicar, no un 500. La
 * regla no se duplica —`canTransition` consulta la MISMA tabla—; lo que cambia
 * es quién responde y con qué cara.
 */

interface Deps {
  leads: LeadRepository;
  unitOfWork: UnitOfWork;
  events: EventPublisher;
  clock: Clock;
}

/**
 * El resumen que devuelven las dos operaciones, construido desde el agregado ya
 * modificado en vez de releer la tabla. Es la misma forma que sirve la bandeja,
 * así que el panel sustituye la fila y no tiene que aprender un segundo tipo.
 */
const toSummary = (lead: Lead): LeadSummary => {
  const props = lead.snapshot();
  return {
    id: props.id,
    contactId: props.contactId,
    conversationId: props.conversationId,
    status: props.status,
    score: props.score.value,
    band: props.score.band,
    ...(props.assignedUserId !== undefined ? { assignedUserId: props.assignedUserId } : {}),
    interestCount: props.interests.length,
    lastActivityAt: props.lastActivityAt,
  };
};

export class ChangeLeadStatusUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: {
    leadId: string;
    status: LeadStatus;
    reason?: string;
  }): Promise<Result<LeadSummary, AppError>> {
    const lead = await this.deps.leads.findById(input.leadId);
    if (!lead) return err(new NotFoundError("Lead", input.leadId));

    // Pedir el estado que ya tiene no es un error: son dos pestañas abiertas, o
    // un doble clic. Se devuelve el lead tal cual y no se escribe historial.
    if (lead.status === input.status) return ok(toSummary(lead));

    if (!canTransition(lead.status, input.status)) {
      return err(
        new ConflictError(
          `Este lead está en "${lead.status}" y desde ahí no se puede pasar a "${input.status}".`,
          {
            leadId: lead.id,
            from: lead.status,
            to: input.status,
            allowed: allowedTransitions(lead.status),
          },
        ),
      );
    }

    const from = lead.status;
    lead.changeStatus(input.status, this.deps.clock.now(), input.reason);

    await this.deps.unitOfWork.run(async () => {
      await this.deps.leads.save(lead);
      await this.deps.events.publish(LeadStatusChanged, {
        leadId: lead.id,
        conversationId: lead.conversationId,
        from,
        to: input.status,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      });
    });

    return ok(toSummary(lead));
  }
}

/**
 * Asignar o devolver al montón.
 *
 * El destinatario se comprueba contra `AdvisorDirectory`, que ya filtra por rol
 * y por estado dentro del tenant en curso. Sin esa comprobación, un identificador
 * copiado de otra inmobiliaria dejaría el lead asignado a un fantasma: nadie lo
 * trabajaría y no aparecería en el "míos" de nadie, que es la peor forma de
 * perder un cliente — en silencio y con la ficha aparentemente en orden.
 */
export class AssignLeadUseCase {
  constructor(private readonly deps: Deps & { advisors: AdvisorDirectory }) {}

  async execute(input: {
    leadId: string;
    userId: string | null;
  }): Promise<Result<LeadSummary, AppError>> {
    const lead = await this.deps.leads.findById(input.leadId);
    if (!lead) return err(new NotFoundError("Lead", input.leadId));

    const now = this.deps.clock.now();
    let changed: boolean;

    if (input.userId === null) {
      changed = lead.unassign(now);
    } else {
      const advisor = await this.deps.advisors.findById(input.userId);
      if (!advisor) {
        return err(
          new ValidationError("Esa persona no está en el equipo o no puede llevar leads.", [
            { path: "userId", message: "No es un asesor asignable de esta inmobiliaria." },
          ]),
        );
      }
      changed = lead.assignTo(input.userId, now);
    }

    if (!changed) return ok(toSummary(lead));

    await this.deps.unitOfWork.run(async () => {
      await this.deps.leads.save(lead);

      // Solo al asignar. `lead.unassigned` no existe como evento de integración
      // y no se inventa aquí uno que nadie escucha: cuando haya un consumidor
      // real —avisar al asesor que lo pierde— se añade con su suscriptor.
      if (input.userId !== null) {
        await this.deps.events.publish(LeadAssigned, {
          leadId: lead.id,
          conversationId: lead.conversationId,
          userId: input.userId,
          score: lead.score.value,
        });
      }
    });

    return ok(toSummary(lead));
  }
}

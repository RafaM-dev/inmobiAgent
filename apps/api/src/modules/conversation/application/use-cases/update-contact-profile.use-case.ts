import type { Clock } from "../../../../platform/clock/clock";
import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import { NotFoundError, type AppError } from "../../../../platform/errors/app-error";
import { err, ok, type Result } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import { ContactProfile, type ProfileChange, type ProfileSlots } from "../../domain/entities/contact-profile";
import type { ContactProfileRepository } from "../../domain/repositories/conversation.repositories";

export interface UpdateContactProfileCommand {
  readonly contactId: string;
  /** Slots propuestos, ya con su procedencia y confianza. */
  readonly slots: ProfileSlots;
  readonly note?: string;
}

/**
 * Actualiza la memoria estructurada del cliente.
 *
 * Recibe slots *propuestos*: el que propone (el extractor del agente en F2, un
 * asesor desde el back-office, o un CRM) no decide si su valor gana. Lo decide
 * la política de fusión del dominio. Es lo que permite que un dato inferido por
 * el modelo nunca pise algo que el cliente dijo con todas las letras.
 */
export class UpdateContactProfileUseCase {
  constructor(
    private readonly deps: {
      profiles: ContactProfileRepository;
      unitOfWork: UnitOfWork;
      clock: Clock;
    },
  ) {}

  async execute(
    command: UpdateContactProfileCommand,
  ): Promise<Result<readonly ProfileChange[], AppError>> {
    const tenantId = TenantContext.requireTenantId();

    return this.deps.unitOfWork.run(async () => {
      const profile =
        (await this.deps.profiles.find(command.contactId)) ??
        ContactProfile.empty(tenantId, command.contactId, this.deps.clock.now());

      if (profile.tenantId !== tenantId) {
        return err(new NotFoundError("Perfil de contacto", command.contactId));
      }

      const changes = profile.apply(command.slots);
      if (command.note) profile.addNote(command.note, this.deps.clock.now());

      if (changes.length > 0 || command.note) {
        await this.deps.profiles.save(profile, changes);
      }

      return ok(changes);
    });
  }
}

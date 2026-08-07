import { DomainError } from "../../../../platform/errors/app-error";

/**
 * Tono con el que el agente habla con el cliente final.
 * Es una decisión del negocio, no del modelo de IA: por eso vive aquí y no en
 * `agent`. El proveedor de LLM la recibe ya resuelta.
 */
export const AgentTone = {
  FORMAL: "FORMAL",
  CERCANO: "CERCANO",
  NEUTRO: "NEUTRO",
} as const;
export type AgentTone = (typeof AgentTone)[keyof typeof AgentTone];

export interface BusinessHours {
  /** Días activos, 0 = domingo. */
  readonly days: readonly number[];
  /** "09:00" en la zona horaria del tenant. */
  readonly from: string;
  readonly to: string;
}

export interface TenantSettingsProps {
  readonly agentDisplayName: string;
  readonly tone: AgentTone;
  readonly welcomeMessage: string | undefined;
  readonly businessHours: BusinessHours | undefined;
  /** Turnos seguidos con fallo antes de escalar a humano (§12.2, regla 2). */
  readonly maxConsecutiveFailedTurns: number;
  /** Correo del buzón de asesores para avisos de escalamiento. */
  readonly handoffEmail: string | undefined;
}

/**
 * Entrada parcial. No usamos `Partial<TenantSettingsProps>` porque con
 * `exactOptionalPropertyTypes` eso prohíbe pasar `undefined` explícito, que es
 * justo lo que produce un objeto validado con Zod.
 */
export type TenantSettingsInput = {
  [K in keyof TenantSettingsProps]?: TenantSettingsProps[K] | undefined;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Un texto en blanco es "sin valor", no un valor vacío. */
const cleanOptional = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

/**
 * Ajustes de comportamiento del tenant.
 *
 * Value Object: inmutable y se compara por valor. Cambiarlo produce una
 * instancia nueva, nunca una mutación — así el agregado `Tenant` controla
 * cuándo se persiste el cambio.
 */
export class TenantSettings {
  private constructor(private readonly props: TenantSettingsProps) {}

  static create(input: TenantSettingsInput = {}): TenantSettings {
    const agentDisplayName = (input.agentDisplayName ?? "Asistente").trim();
    if (agentDisplayName.length === 0) {
      throw new DomainError("El nombre del agente no puede estar vacío");
    }

    const maxConsecutiveFailedTurns = input.maxConsecutiveFailedTurns ?? 2;
    if (maxConsecutiveFailedTurns < 1) {
      throw new DomainError("maxConsecutiveFailedTurns debe ser al menos 1", {
        maxConsecutiveFailedTurns,
      });
    }

    const businessHours = input.businessHours;
    if (businessHours) {
      if (!TIME_PATTERN.test(businessHours.from) || !TIME_PATTERN.test(businessHours.to)) {
        throw new DomainError("El horario de atención debe usar el formato HH:mm", {
          from: businessHours.from,
          to: businessHours.to,
        });
      }
      if (businessHours.days.some((d) => d < 0 || d > 6)) {
        throw new DomainError("Los días de atención van de 0 (domingo) a 6 (sábado)");
      }
    }

    return new TenantSettings({
      agentDisplayName,
      tone: input.tone ?? AgentTone.CERCANO,
      welcomeMessage: cleanOptional(input.welcomeMessage),
      businessHours,
      maxConsecutiveFailedTurns,
      handoffEmail: cleanOptional(input.handoffEmail),
    });
  }

  get agentDisplayName(): string {
    return this.props.agentDisplayName;
  }
  get tone(): AgentTone {
    return this.props.tone;
  }
  get welcomeMessage(): string | undefined {
    return this.props.welcomeMessage;
  }
  get businessHours(): BusinessHours | undefined {
    return this.props.businessHours;
  }
  get maxConsecutiveFailedTurns(): number {
    return this.props.maxConsecutiveFailedTurns;
  }
  get handoffEmail(): string | undefined {
    return this.props.handoffEmail;
  }

  with(changes: TenantSettingsInput): TenantSettings {
    return TenantSettings.create({ ...this.props, ...changes });
  }

  toJSON(): TenantSettingsProps {
    return { ...this.props };
  }
}

import { DomainError } from "../../../../platform/errors/app-error";
import type { ChannelType } from "../value-objects/channel-type";

export const ChannelAccountStatus = {
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
} as const;
export type ChannelAccountStatus =
  (typeof ChannelAccountStatus)[keyof typeof ChannelAccountStatus];

export interface ChannelAccountProps {
  readonly id: string;
  readonly tenantId: string;
  readonly channelType: ChannelType;
  /**
   * Identidad de esta cuenta en el proveedor: el `phone_number_id` de WhatsApp,
   * el id del bot de Telegram, el nombre de la sala en consola. Es lo que llega
   * en el webhook y lo único que resuelve el tenant (docs §7.1, paso 5).
   */
  readonly externalId: string;
  readonly displayName: string;
  readonly status: ChannelAccountStatus;
  /** Ajustes no secretos del canal. Los secretos van cifrados aparte. */
  readonly config: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Cuenta de canal: el número de WhatsApp, el bot de Telegram o la sala de
 * consola de una inmobiliaria concreta.
 *
 * Su razón de existir es la resolución de tenant: NUNCA se confía en el
 * `tenantId` que venga en el payload de un proveedor; se deduce de la cuenta
 * por la que entró el mensaje.
 */
export class ChannelAccount {
  private constructor(private props: ChannelAccountProps) {}

  static create(input: {
    id: string;
    tenantId: string;
    channelType: ChannelType;
    externalId: string;
    displayName: string;
    config?: Record<string, unknown>;
    now: Date;
  }): ChannelAccount {
    const externalId = input.externalId.trim();
    if (externalId.length === 0) {
      throw new DomainError("La cuenta de canal necesita un identificador externo");
    }

    return new ChannelAccount({
      id: input.id,
      tenantId: input.tenantId,
      channelType: input.channelType,
      externalId,
      displayName: input.displayName.trim() || externalId,
      status: ChannelAccountStatus.ACTIVE,
      config: input.config ?? {},
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  static rehydrate(props: ChannelAccountProps): ChannelAccount {
    return new ChannelAccount(props);
  }

  get id(): string {
    return this.props.id;
  }
  get tenantId(): string {
    return this.props.tenantId;
  }
  get channelType(): ChannelType {
    return this.props.channelType;
  }
  get externalId(): string {
    return this.props.externalId;
  }
  get displayName(): string {
    return this.props.displayName;
  }
  get status(): ChannelAccountStatus {
    return this.props.status;
  }
  get config(): Readonly<Record<string, unknown>> {
    return this.props.config;
  }
  get isActive(): boolean {
    return this.props.status === ChannelAccountStatus.ACTIVE;
  }

  disable(now: Date): void {
    this.props = { ...this.props, status: ChannelAccountStatus.DISABLED, updatedAt: now };
  }

  enable(now: Date): void {
    this.props = { ...this.props, status: ChannelAccountStatus.ACTIVE, updatedAt: now };
  }

  snapshot(): ChannelAccountProps {
    return { ...this.props };
  }
}

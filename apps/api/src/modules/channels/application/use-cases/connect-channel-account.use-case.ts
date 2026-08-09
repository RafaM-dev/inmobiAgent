import { NotFoundError, ValidationError, type AppError } from "../../../../platform/errors/app-error";
import type { Logger } from "../../../../platform/logging/logger";
import { err, isErr, ok, type Result } from "../../../../platform/result/result";
import type { ChannelAccountRepository } from "../../domain/repositories/channel-account.repository";
import type { ChannelType } from "../../domain/value-objects/channel-type";
import type { ChannelCredentials } from "../ports/channel-credentials";
import type { ChannelRegistry, ChatChannel } from "../ports/chat-channel";
import type { ChannelAccountSummary } from "./list-channel-accounts.use-case";
import type { RegisterChannelAccountUseCase } from "./register-channel-account.use-case";

export interface ConnectChannelAccountCommand {
  readonly channelType: ChannelType;
  readonly externalId: string;
  readonly displayName: string;
  /** Secretos del proveedor. Se cifran; nunca vuelven a salir del servidor. */
  readonly credentials: Readonly<Record<string, string>>;
}

export interface ConnectChannelAccountResult {
  /**
   * La misma proyección que devuelve el listado, y no `ChannelAccountView`:
   * esa lleva `config` —donde viven ajustes del proveedor— y va hacia los
   * adaptadores, no hacia el navegador.
   */
  readonly account: ChannelAccountSummary;
  readonly verified: boolean;
  /** Por qué no se pudo confirmar. Ausente cuando `verified`. */
  readonly verificationMessage?: string;
}

/**
 * Conecta una cuenta de canal desde el back-office: la da de alta y guarda sus
 * credenciales cifradas.
 *
 * NO SABE QUÉ ES WHATSAPP. Recibe un tipo de canal y un diccionario de
 * secretos; qué claves lleva ese diccionario lo decide el adaptador, y quién
 * las rellena es la ruta. Conectar Telegram el día de mañana no toca este
 * archivo.
 *
 * **D80 — comprobar no es un portero.** Si el canal sabe verificar
 * credenciales, se le pregunta; pero un "no" NO impide guardar. La razón es
 * asimétrica: si la comprobación falla y aun así guardamos, la inmobiliaria ve
 * un aviso claro y vuelve a pegar el token. Si la comprobación falla por
 * nuestra parte —Meta caída, un endpoint que cambió— y eso bloqueara el alta,
 * nadie podría conectar WhatsApp y no habría forma de saltárselo. Un producto
 * que se auto-bloquea por su propio diagnóstico es peor que uno que avisa.
 *
 * Por eso se verifica ANTES de guardar pero se guarda IGUAL: lo primero para
 * que la comprobación sirva de algo, lo segundo para que no sea un obstáculo.
 */
export class ConnectChannelAccountUseCase {
  constructor(
    private readonly deps: {
      register: RegisterChannelAccountUseCase;
      accounts: ChannelAccountRepository;
      channels: ChannelRegistry;
      credentials: ChannelCredentials;
      logger: Logger;
    },
  ) {}

  async execute(
    command: ConnectChannelAccountCommand,
  ): Promise<Result<ConnectChannelAccountResult, AppError>> {
    /*
     * Que el canal exista se comprueba lo primero. WhatsApp solo está en el
     * registro si la app de Meta está configurada en el despliegue (D31), y dar
     * de alta una cuenta de un canal que esta instalación no sabe operar
     * dejaría una fila que promete algo que nadie puede cumplir.
     */
    const channel = this.deps.channels.get(command.channelType);
    if (!channel) {
      return err(
        new ValidationError(
          `Este despliegue no tiene configurado el canal ${command.channelType}`,
        ),
      );
    }

    const verification = await this.verify(channel, command);

    const registered = await this.deps.register.execute({
      channelType: command.channelType,
      externalId: command.externalId,
      displayName: command.displayName,
    });
    if (isErr(registered)) return registered;

    const stored = await this.deps.credentials.set(registered.value.id, command.credentials);
    if (isErr(stored)) return stored;

    this.deps.logger.info("Canal conectado", {
      channelType: command.channelType,
      accountId: registered.value.id,
      verified: verification.verified,
    });

    /*
     * Se relee la cuenta en vez de dar por hecho que está activa. Hoy nada la
     * desactiva y la suposición acertaría siempre; el día que exista un botón
     * de desconectar, este endpoint respondería "activa" sobre una línea que no
     * lo está y nadie relacionaría el fallo con esta línea de código.
     */
    const saved = await this.deps.accounts.findById(registered.value.id);
    if (!saved) {
      return err(new NotFoundError("Cuenta de canal", registered.value.id));
    }

    return ok({
      account: {
        id: saved.id,
        channelType: saved.channelType,
        externalId: saved.externalId,
        displayName: saved.displayName,
        isActive: saved.isActive,
      },
      ...verification,
    });
  }

  /** Pregunta al canal si las credenciales sirven. Nunca lanza ni bloquea. */
  private async verify(
    channel: ChatChannel,
    command: ConnectChannelAccountCommand,
  ): Promise<{ verified: boolean; verificationMessage?: string }> {
    if (!channel.verifyCredentials) {
      // Un canal sin secretos que comprobar —la consola— no es un fallo, pero
      // tampoco es una confirmación: no se puede afirmar lo que no se miró.
      return { verified: false, verificationMessage: "Este canal no admite comprobación" };
    }

    const checked = await channel.verifyCredentials({
      externalId: command.externalId,
      credentials: command.credentials,
    });

    if (isErr(checked)) {
      this.deps.logger.warn("El proveedor no confirmó las credenciales", {
        channelType: command.channelType,
        errorCode: checked.error.code,
      });
      return { verified: false, verificationMessage: checked.error.message };
    }

    return { verified: true };
  }
}

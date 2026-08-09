import { generateSessionToken, hashSessionToken } from "../../../../platform/crypto/password";
import type { Clock } from "../../../../platform/clock/clock";
import type { IdGenerator } from "../../../../platform/ids/id-generator";
import type { Logger } from "../../../../platform/logging/logger";
import type { Notifier } from "../../../../platform/notifications/notifier";
import { isErr } from "../../../../platform/result/result";
import type { User } from "../../domain/entities/user";
import { UserToken, type UserTokenPurpose } from "../../domain/entities/user-token";
import type { UserTokenRepository } from "../../domain/repositories/user-token.repository";

/**
 * Emite el enlace de un solo uso y lo manda por correo.
 *
 * Lo comparten invitar y recuperar contraseña porque el mecanismo es idéntico
 * —emitir, invalidar los anteriores, enviar— y solo cambian el propósito y el
 * texto. Escribirlo dos veces sería tener dos sitios donde arreglar el mismo
 * fallo de seguridad.
 *
 * Reutiliza `generateSessionToken` y `hashSessionToken`: 256 bits de entropía y
 * en base solo el hash, exactamente el mismo trato que la cookie de sesión.
 */

export interface IssuedLink {
  /**
   * El enlace en claro.
   *
   * Solo se devuelve para poder enseñárselo a quien invita CUANDO no hay correo
   * configurado. Nunca sale del servidor en el camino de recuperación, donde
   * quien lo pide es anónimo.
   */
  readonly url: string;
  /** `false` cuando el despliegue no tiene SMTP y el aviso solo se registró. */
  readonly delivered: boolean;
}

const PATH: Record<UserTokenPurpose, string> = {
  INVITATION: "/aceptar-invitacion",
  PASSWORD_RESET: "/restablecer-contrasena",
};

export class InvitationMailer {
  constructor(
    private readonly deps: {
      tokens: UserTokenRepository;
      notifier: Notifier;
      backofficeUrl: string;
      clock: Clock;
      ids: IdGenerator;
      logger: Logger;
    },
  ) {}

  async issue(input: {
    user: User;
    purpose: UserTokenPurpose;
    tenantName: string;
    tenantSlug: string;
    /** Quién invita. Ausente en recuperación: allí no hay nadie detrás. */
    invitedBy?: string;
  }): Promise<IssuedLink> {
    const now = this.deps.clock.now();

    /*
     * Los enlaces anteriores dejan de valer al emitir uno nuevo. Sin esto, un
     * correo de recuperación de hace tres semanas seguiría abriendo la cuenta,
     * y esos correos acaban reenviados, archivados y en cualquier sitio.
     */
    await this.deps.tokens.invalidateOpen(input.user.id, input.purpose, now);

    const clear = generateSessionToken();
    await this.deps.tokens.save(
      UserToken.issue({
        id: this.deps.ids.generate(),
        tenantId: input.user.tenantId,
        userId: input.user.id,
        purpose: input.purpose,
        tokenHash: hashSessionToken(clear),
        now,
      }),
    );

    const url =
      `${this.deps.backofficeUrl}${PATH[input.purpose]}` +
      `?token=${encodeURIComponent(clear)}&inmobiliaria=${encodeURIComponent(input.tenantSlug)}`;

    const sent = await this.deps.notifier.send({
      to: input.user.email,
      subject:
        input.purpose === "INVITATION"
          ? `Te han dado acceso al panel de ${input.tenantName}`
          : `Restablecer tu contraseña de ${input.tenantName}`,
      body: compose({ ...input, url }),
    });

    if (isErr(sent)) {
      /*
       * No se propaga el fallo. La invitación YA está creada y el enlace es
       * válido; devolver error haría que quien invita lo intentara otra vez y
       * generara un tercer token. Se registra y se avisa arriba con
       * `delivered: false`, que es lo que permite ofrecer el enlace a mano.
       */
      this.deps.logger.warn("No se pudo enviar el enlace por correo", {
        purpose: input.purpose,
        userId: input.user.id,
        errorCode: sent.error.code,
      });
      return { url, delivered: false };
    }

    // Con el notificador de registro el correo no sale de la máquina: se
    // escribe en el log. Para quien invita, eso NO es haberlo entregado.
    return { url, delivered: this.deps.notifier.channel !== "log" };
  }
}

/** Texto plano, legible en un móvil y sin adornos que ensucien la lectura. */
const compose = (input: {
  user: User;
  purpose: UserTokenPurpose;
  tenantName: string;
  invitedBy?: string;
  url: string;
}): string => {
  const lines: string[] = [`Hola ${input.user.displayName},`, ""];

  if (input.purpose === "INVITATION") {
    lines.push(
      input.invitedBy
        ? `${input.invitedBy} te ha dado acceso al panel de ${input.tenantName}.`
        : `Tienes acceso al panel de ${input.tenantName}.`,
      "",
      "Para entrar, elige una contraseña aquí:",
      input.url,
      "",
      "El enlace caduca en 7 días.",
    );
  } else {
    lines.push(
      `Alguien ha pedido restablecer la contraseña de tu cuenta en ${input.tenantName}.`,
      "",
      "Si has sido tú, elige una contraseña nueva aquí:",
      input.url,
      "",
      "El enlace caduca en 1 hora y solo se puede usar una vez.",
      "Si no has sido tú, ignora este correo: tu contraseña no ha cambiado.",
    );
  }

  return lines.join("\n");
};

import { createTransport, type Transporter } from "nodemailer";
import { UpstreamError, type AppError } from "../errors/app-error";
import type { Logger } from "../logging/logger";
import { err, ok, type Result } from "../result/result";
import type { Notification, Notifier } from "./notifier";

export interface SmtpOptions {
  readonly host: string;
  readonly port: number;
  /** TLS desde el primer byte. Falso en 587 (STARTTLS) y en Mailpit. */
  readonly secure: boolean;
  readonly user?: string;
  readonly password?: string;
  /** Remitente. Debe ser un dominio que el servidor acepte firmar. */
  readonly from: string;
  readonly timeoutMs: number;
}

/**
 * Envío por SMTP.
 *
 * SMTP y no la API de un proveedor concreto: es lo único que hablan todos.
 * Mailpit en desarrollo, y en producción el correo que la inmobiliaria ya tenga
 * —Google Workspace, Microsoft 365, Amazon SES— sin que nosotros elijamos por
 * ellos ni pidamos una clave de un servicio más.
 *
 * El transporte se crea UNA vez y se reutiliza: `nodemailer` mantiene el pool
 * de conexiones. Crearlo por aviso significaría una negociación TLS completa
 * cada vez que alguien pide hablar con un asesor.
 */
export class SmtpNotifier implements Notifier {
  readonly channel = "smtp";

  private readonly transport: Transporter;

  constructor(
    private readonly deps: {
      options: SmtpOptions;
      logger: Logger;
    },
  ) {
    const { host, port, secure, user, password, timeoutMs } = deps.options;

    this.transport = createTransport({
      host,
      port,
      secure,
      // Sin credenciales cuando no las hay: Mailpit y muchos relés internos no
      // piden autenticación, y mandar un `auth` vacío les hace rechazar.
      ...(user !== undefined && password !== undefined ? { auth: { user, pass: password } } : {}),
      connectionTimeout: timeoutMs,
      greetingTimeout: timeoutMs,
      socketTimeout: timeoutMs,
    });
  }

  async send(notification: Notification): Promise<Result<void, AppError>> {
    try {
      await this.transport.sendMail({
        from: this.deps.options.from,
        to: notification.to,
        subject: notification.subject,
        text: notification.body,
      });

      return ok(undefined);
    } catch (cause) {
      /*
       * El error se registra aquí, con el destinatario, y NO se mete en el
       * `AppError`: una dirección de correo es un dato personal y el error
       * viaja por trazas y respuestas HTTP.
       */
      this.deps.logger.warn("El servidor de correo rechazó el aviso", {
        to: notification.to,
        host: this.deps.options.host,
        error: cause instanceof Error ? cause.message : String(cause),
      });

      return err(new UpstreamError("smtp", "unavailable", cause));
    }
  }
}

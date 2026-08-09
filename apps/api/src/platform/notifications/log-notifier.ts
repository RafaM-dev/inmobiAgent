import type { Logger } from "../logging/logger";
import { ok, type Result } from "../result/result";
import type { AppError } from "../errors/app-error";
import type { Notification, Notifier } from "./notifier";

/**
 * Adaptador por defecto: escribe el aviso en el log y da por buena la entrega.
 *
 * Es el que está activo mientras no haya SMTP configurado, y existe por la
 * misma razón que `MockLLMProvider`: **la aplicación entera tiene que funcionar
 * sin configurar ningún servicio externo**. Un desarrollador que clona el
 * repositorio y escala una conversación tiene que ver el aviso, y lo ve.
 *
 * Se registra en `info` y no en `debug` a propósito: si un despliegue se queda
 * con este adaptador por descuido, los avisos que nadie está recibiendo salen
 * en el log al nivel por defecto en vez de desaparecer en silencio.
 */
export class LogNotifier implements Notifier {
  readonly channel = "log";

  constructor(private readonly deps: { logger: Logger }) {}

  send(notification: Notification): Promise<Result<void, AppError>> {
    this.deps.logger.info("Aviso (sin SMTP configurado: no se ha enviado nada)", {
      to: notification.to,
      subject: notification.subject,
      body: redactTokens(notification.body),
    });

    return Promise.resolve(ok(undefined));
  }
}

/**
 * Tapa los tokens de los enlaces antes de escribirlos.
 *
 * Cuando este adaptador solo mandaba avisos de escalado, volcar el cuerpo
 * entero era inofensivo. Desde que también manda invitaciones y
 * restablecimientos, ese cuerpo lleva dentro **una credencial que abre una
 * cuenta** — y los logs se envían fuera, se guardan meses y los lee gente que
 * no tendría por qué poder entrar en el panel de un cliente.
 *
 * El enlace completo sigue llegando a quien hizo la operación: la pantalla de
 * equipo lo enseña y el comando de alta lo imprime. El log no es el sitio.
 */
const redactTokens = (body: string): string => body.replace(/token=[^&\s]+/g, "token=[oculto]");

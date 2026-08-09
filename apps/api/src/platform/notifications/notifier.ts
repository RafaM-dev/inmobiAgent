import type { AppError } from "../errors/app-error";
import type { Result } from "../result/result";

/* ========================================================================== *
 * PUERTO `Notifier` — avisar a una persona del equipo.
 *
 * Correo hoy; mañana puede ser un mensaje a Slack, un SMS o una notificación
 * al móvil. Por eso el puerto habla de "aviso" y no de "correo": el asunto y el
 * cuerpo son lo único que todo canal de aviso tiene en común.
 *
 * No hay HTML, ni adjuntos, ni copia oculta, ni plantillas. Un aviso operativo
 * se lee en tres segundos en el móvil y lleva un enlace. Todo lo demás sería
 * cargar el puerto con lo que solo sabe hacer el correo, y el día que esto
 * mande un mensaje a Slack habría que quitarlo.
 * ========================================================================== */

export interface Notification {
  /** Destinatario en el canal de aviso. Con correo, una dirección. */
  readonly to: string;
  readonly subject: string;
  /** Texto plano. Los saltos de línea se respetan. */
  readonly body: string;
}

export interface Notifier {
  /** Identificador del adaptador activo. Aparece en las trazas. */
  readonly channel: string;

  /**
   * Devuelve `Result` y no lanza: que un servidor de correo esté caído es un
   * caso esperado. Quien llama decide si lo reintenta o lo deja pasar, y esa
   * decisión depende de si el aviso importa — no la puede tomar el adaptador.
   */
  send(notification: Notification): Promise<Result<void, AppError>>;
}

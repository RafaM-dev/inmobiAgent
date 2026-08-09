import { UpstreamError, type AppError } from "../errors/app-error";
import { err, ok, type Result } from "../result/result";
import type { Notification, Notifier } from "./notifier";

/**
 * Doble de `Notifier` para pruebas: guarda los avisos en vez de enviarlos.
 *
 * Vive junto al puerto y no en la carpeta de tests de un módulo porque lo usan
 * varios: el handler del escalado, el flujo de punta a punta del agente y lo
 * que venga. Una copia por módulo acabaría con tres que se comportan distinto.
 */
export class InMemoryNotifier implements Notifier {
  readonly channel = "memoria";
  readonly sent: Notification[] = [];

  /** Cuando es `true`, todo envío falla. Para probar el camino del reintento. */
  failing = false;

  send(notification: Notification): Promise<Result<void, AppError>> {
    if (this.failing) {
      return Promise.resolve(err(new UpstreamError("smtp", "unavailable")));
    }

    this.sent.push(notification);
    return Promise.resolve(ok(undefined));
  }

  /** El último aviso, que es el que casi siempre quiere comprobar un test. */
  get last(): Notification | undefined {
    return this.sent.at(-1);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

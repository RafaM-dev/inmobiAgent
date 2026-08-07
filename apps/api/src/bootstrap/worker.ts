/**
 * Punto de entrada del proceso worker.
 *
 * Mismo código que la API, distinto rol: procesa el outbox, los jobs de turno
 * conversacional, la ingesta de documentos y los recordatorios de citas.
 *
 * Existe desde F0 aunque en desarrollo se use `APP_ROLE=all`, porque separar
 * procesos después de tener carga real siempre implica refactor. Así el día que
 * haga falta escalar solo se cambia una variable de entorno.
 */
process.env["APP_ROLE"] = "worker";

await import("../main");

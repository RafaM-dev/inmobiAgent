import type { AwilixContainer } from "awilix";
import type { EventSubscription } from "../events/event";

/**
 * Contrato de un módulo del monolito modular.
 *
 * Cada módulo declara qué registra, a qué eventos reacciona y qué rutas expone.
 * El arranque es entonces una lista de módulos: añadir uno no toca el servidor,
 * y quitarlo no deja restos por el código.
 *
 * Es también el ensayo general de la migración a microservicios: un módulo que
 * cumple este contrato ya sabe arrancar, suscribirse y servir por sí mismo.
 *
 * `TCradle` queda genérico para que platform no dependa del composition root.
 */
export interface ModuleRegistration<TCradle extends object, THttpApp = unknown> {
  readonly name: string;

  /** Registra implementaciones concretas en el contenedor de DI. */
  registerDependencies(container: AwilixContainer<TCradle>): void;

  /** Consumidores de eventos de otros módulos. */
  registerSubscriptions?(cradle: TCradle): EventSubscription[];

  /** Rutas HTTP, webhooks y streams. */
  registerRoutes?(app: THttpApp, cradle: TCradle): Promise<void> | void;

  /** Arranque de recursos propios (conexiones, temporizadores). */
  onStart?(cradle: TCradle): Promise<void> | void;

  /** Liberación ordenada. Se ejecuta en orden inverso al de arranque. */
  onStop?(cradle: TCradle): Promise<void> | void;
}

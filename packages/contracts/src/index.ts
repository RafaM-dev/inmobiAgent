/**
 * Contratos compartidos entre `apps/api` y `apps/web`.
 *
 * Regla: aquí solo viven schemas Zod y tipos derivados. Nada de lógica,
 * nada de dependencias de runtime. Es la frontera pública de la API.
 */
export * from "./common/primitives";
export * from "./common/pagination";
export * from "./common/api-error";
export * from "./system/health";
export * from "./auth/session";
export * from "./backoffice/blocks";
export * from "./backoffice/inbox";
export * from "./backoffice/pipeline";
export * from "./backoffice/knowledge";
export * from "./backoffice/settings";
export * from "./channels/console";

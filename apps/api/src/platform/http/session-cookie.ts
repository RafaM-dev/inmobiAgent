/**
 * La cookie de sesión del back-office.
 *
 * Vive en el kernel y no en `identity` ni en `bootstrap` porque la necesitan
 * los dos: quien emite la cookie al entrar y quien la lee en cada petición.
 * Ponerla en cualquiera de los dos lados creaba un ciclo.
 *
 * En producción lleva el prefijo `__Host-`, que el navegador solo acepta si la
 * cookie va por HTTPS, sin `Domain` y con `Path=/`. Eso la hace inmune a que un
 * subdominio comprometido la sobrescriba — un ataque real contra el que un
 * `Secure` a secas no protege.
 */

const PRODUCTION_NAME = "__Host-agentinmobi_session";
const DEVELOPMENT_NAME = "agentinmobi_session";

export const sessionCookieName = (isProduction: boolean): string =>
  isProduction ? PRODUCTION_NAME : DEVELOPMENT_NAME;

export interface SessionCookieOptions {
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: "lax";
  readonly path: "/";
  readonly expires?: Date;
}

/**
 * - `httpOnly`: ningún JavaScript la lee. Convierte un XSS en una molestia en
 *   vez de en un robo de sesión.
 * - `sameSite: lax`: el navegador no la envía en peticiones cruzadas desde otro
 *   sitio, que es CSRF resuelto sin tokens adicionales. `lax` y no `strict`
 *   para que llegar desde un enlace externo no muestre la sesión cerrada.
 * - `secure` en producción: nunca viaja en claro.
 */
export const sessionCookieOptions = (
  isProduction: boolean,
  expires?: Date,
): SessionCookieOptions => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax",
  path: "/",
  ...(expires ? { expires } : {}),
});

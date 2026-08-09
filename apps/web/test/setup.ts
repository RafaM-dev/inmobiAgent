import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * Preparación común de las pruebas del panel.
 *
 * Dos limpiezas, y las dos existen por el mismo motivo: que el resultado de una
 * prueba no dependa de las que corrieron antes. Un panel que solo funciona
 * cuando los tests van en cierto orden es un panel del que nadie se fía.
 */

/**
 * `matchMedia` no existe en jsdom, y el selector de tema lo consulta para saber
 * si el sistema está en oscuro.
 *
 * Se define aquí y no dentro de `applyTheme` con una comprobación defensiva: en
 * un navegador esta API existe siempre, así que un `typeof … === "function"` en
 * el código de producción sería una rama que nunca se ejecuta fuera de los
 * tests. La carencia es del entorno de pruebas y se tapa en el entorno de
 * pruebas.
 *
 * Por defecto responde "claro" para que el panel se renderice en el tema del
 * que hablan las aserciones. Una prueba que necesite el oscuro puede
 * reemplazarlo con `vi.stubGlobal`.
 */
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

afterEach(() => {
  // Desmonta lo renderizado: sin esto, los efectos siguen vivos y una petición
  // de la prueba anterior puede resolverse en medio de la siguiente.
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

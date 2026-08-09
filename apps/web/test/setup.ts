import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * Preparación común de las pruebas del panel.
 *
 * Dos limpiezas, y las dos existen por el mismo motivo: que el resultado de una
 * prueba no dependa de las que corrieron antes. Un panel que solo funciona
 * cuando los tests van en cierto orden es un panel del que nadie se fía.
 */
afterEach(() => {
  // Desmonta lo renderizado: sin esto, los efectos siguen vivos y una petición
  // de la prueba anterior puede resolverse en medio de la siguiente.
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

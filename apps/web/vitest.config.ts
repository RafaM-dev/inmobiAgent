import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Pruebas del back-office.
 *
 * `jsdom` y no un navegador de verdad: lo que se prueba aquí es la lógica del
 * panel —qué se pinta, qué estado tiene la sesión, qué pasa cuando la API
 * responde mal—, no el motor de renderizado de Chrome. Un navegador real
 * multiplicaría por veinte el tiempo de la suite para verificar algo que ya
 * verifica el navegador.
 *
 * Se comparte el plugin de React con `vite.config.ts` para que los componentes
 * se transformen exactamente igual que en el bundle que se despliega.
 */
export default defineConfig({
  plugins: [react()],
  /*
   * El mismo alias que `vite.config.ts`. Duplicarlo es feo, pero vitest no lee
   * la configuración de vite en este proyecto, y sin esto los componentes de
   * shadcn —que se importan con `@/…`— no resuelven en las pruebas: el fallo es
   * un módulo no encontrado, no un test en rojo, y despista el doble.
   */
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    globals: false,
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Ninguna prueba del panel toca la red ni el reloj de verdad: si una tarda
    // segundos, es que está esperando algo que nunca va a pasar.
    testTimeout: 5_000,
  },
});

import react from "@vitejs/plugin-react";
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

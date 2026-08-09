import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

/**
 * El servidor de desarrollo hace de proxy de `/api` hacia la API.
 *
 * No es comodidad: la cookie de sesión es `httpOnly` y `SameSite=Lax`. Si el
 * navegador viera dos orígenes distintos (5173 y 3100), no la enviaría, y todo
 * el back-office parecería no tener sesión. Con el proxy, para el navegador
 * todo ocurre en el mismo origen — igual que ocurrirá en producción.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `@/…` es la convención que espera shadcn y la que evita los `../../../`.
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  server: {
    // Explícito para que responda igual en `localhost` y en `127.0.0.1`: en
    // Windows, "localhost" resuelve a ::1 y deja fuera a cualquier herramienta
    // que use IPv4.
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        // 127.0.0.1 y no "localhost": en Windows resuelve a ::1 y la API
        // escucha en IPv4.
        target: "http://127.0.0.1:3100",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});

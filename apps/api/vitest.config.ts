import { defineConfig } from "vitest/config";

/**
 * Sin alias de rutas a propósito: dentro de un módulo los imports son
 * relativos. Un módulo que solo se referencia a sí mismo con rutas relativas se
 * puede mover a otro repositorio sin reescribir un solo import — que es
 * exactamente el objetivo de "preparado para microservicios".
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.{test,spec}.ts", "src/**/index.ts", "src/generated/**"],
    },
  },
});

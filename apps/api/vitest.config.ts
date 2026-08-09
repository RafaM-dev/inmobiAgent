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
    /*
     * `src/` y la evaluación de calidad. La suite de integración vive en
     * `test/` con su propia configuración: necesita Postgres levantado, y
     * `pnpm test` tiene que funcionar en un clon recién hecho.
     *
     * La evaluación entra aquí a propósito. Corre contra el simulador —sin
     * claves, sin coste y determinista—, y una suite de evaluación que solo se
     * ejecuta a mano se ejecuta la semana que se escribe y nunca más.
     */
    include: ["src/**/*.{test,spec}.ts", "eval/**/*.eval.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.{test,spec}.ts", "src/**/index.ts", "src/generated/**"],
    },
  },
});

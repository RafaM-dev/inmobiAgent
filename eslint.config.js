import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/.turbo/**",
      "apps/api/src/generated/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /* El dominio se modela con tipos, no con `any`. */
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      /* Los errores esperados se modelan con Result, no con excepciones sueltas. */
      "@typescript-eslint/only-throw-error": "error",
      /* Los logs pasan por el puerto Logger: con redacción de PII y correlación. */
      "no-console": "error",
      /* Usamos el patrón Null Object de forma deliberada (NoopLogger,
         NoopUnitOfWork, dobles de prueba): sus métodos vacíos son la intención. */
      "@typescript-eslint/no-empty-function": "off",
    },
  },

  /* Archivos de configuración en JS: sin reglas que exijan tipos. */
  {
    files: ["**/*.{js,cjs,mjs}"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { module: "writable", require: "readonly", __dirname: "readonly" },
    },
  },

  /* ------------------------------------------------------------------ *
   * Fronteras arquitectónicas que ESLint puede vigilar por sí solo.
   * Las reglas de capa completas viven en .dependency-cruiser.cjs
   * ------------------------------------------------------------------ */
  {
    files: ["apps/api/src/modules/*/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@prisma/client",
                "fastify",
                "axios",
                "awilix",
                "pino",
                "**/infrastructure/**",
                "**/interface/**",
                "**/application/**",
              ],
              message:
                "El dominio no puede depender de frameworks, infraestructura ni de la capa de aplicación. Define un puerto.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/api/src/modules/*/application/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@prisma/client",
                "fastify",
                "axios",
                "openai",
                "@anthropic-ai/*",
                "**/infrastructure/**",
                "**/interface/**",
              ],
              message:
                "La capa de aplicación depende de puertos, no de implementaciones. Mueve esto a infrastructure/.",
            },
          ],
        },
      ],
    },
  },

  /* Los tests pueden ser más laxos. */
  {
    files: ["**/*.{test,spec}.ts", "**/testing/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "no-console": "off",
    },
  },

  /* Config, scripts de operación y seeds.
     Son programas de terminal: su interfaz de usuario ES la consola, y por eso
     `no-console` no aplica. El logger con redacción de PII manda dentro de la
     aplicación, no en una herramienta que ejecuta una persona a mano. */
  {
    files: [
      "*.config.{js,ts}",
      "**/*.config.{js,ts}",
      "**/scripts/**/*.ts",
      "**/prisma/seed/**/*.ts",
    ],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
);

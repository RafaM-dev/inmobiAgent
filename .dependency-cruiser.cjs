/**
 * Reglas arquitectónicas ejecutables.
 *
 * Este archivo es el guardián de `docs/00-ARCHITECTURE.md`. Si una regla de
 * arquitectura no se puede verificar aquí, con el tiempo se incumple.
 * `pnpm arch:check` corre en CI y rompe el build.
 */
module.exports = {
  forbidden: [
    /* ------------------------------------------------------------------ *
     * 1. Regla de dependencia de Clean Architecture
     * ------------------------------------------------------------------ */
    {
      name: "domain-no-outward-deps",
      severity: "error",
      comment:
        "El dominio es el centro: no puede depender de application, infrastructure ni interface.",
      from: { path: "^apps/api/src/modules/([^/]+)/domain/" },
      to: { path: "^apps/api/src/modules/[^/]+/(application|infrastructure|interface)/" },
    },
    {
      name: "application-no-infrastructure",
      severity: "error",
      comment:
        "La capa de aplicación define puertos; las implementaciones viven en infrastructure y se inyectan.",
      from: { path: "^apps/api/src/modules/([^/]+)/application/" },
      to: { path: "^apps/api/src/modules/[^/]+/(infrastructure|interface)/" },
    },
    {
      name: "interface-no-direct-infrastructure",
      severity: "error",
      comment:
        "Las rutas y webhooks invocan casos de uso, nunca repositorios ni clientes HTTP directamente.",
      from: { path: "^apps/api/src/modules/([^/]+)/interface/" },
      to: { path: "^apps/api/src/modules/[^/]+/infrastructure/" },
    },

    /* ------------------------------------------------------------------ *
     * 2. Aislamiento entre módulos (preparación para microservicios)
     * ------------------------------------------------------------------ */
    {
      name: "cross-module-only-via-public-api",
      severity: "error",
      comment:
        "Un módulo solo puede tocar el index.ts de otro módulo. Nada de imports a sus tripas.",
      // Los tests y los dobles se rigen por la regla siguiente.
      from: {
        path: "^apps/api/src/modules/([^/]+)/",
        pathNot: "(/testing/|\\.test\\.ts$)",
      },
      to: {
        path: "^apps/api/src/modules/([^/]+)/",
        pathNot: ["^apps/api/src/modules/$1/", "^apps/api/src/modules/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "cross-module-test-doubles-only-from-testing",
      severity: "error",
      comment:
        "Un test puede usar el index.ts de otro módulo o sus dobles de prueba (testing/), " +
        "pero nunca sus tripas. Compartir dobles es legítimo: prueba contra el comportamiento " +
        "real en vez de contra una imitación que miente.",
      from: { path: "^apps/api/src/modules/([^/]+)/(testing/|.*\\.test\\.ts$)" },
      to: {
        path: "^apps/api/src/modules/([^/]+)/",
        pathNot: [
          "^apps/api/src/modules/$1/",
          "^apps/api/src/modules/[^/]+/index\\.ts$",
          "^apps/api/src/modules/[^/]+/testing/",
        ],
      },
    },
    {
      name: "platform-is-a-kernel",
      severity: "error",
      comment:
        "platform/ es el kernel compartido: no puede conocer ningún módulo de negocio.",
      from: { path: "^apps/api/src/platform/" },
      to: { path: "^apps/api/src/modules/" },
    },

    /* ------------------------------------------------------------------ *
     * 3. El dominio es TypeScript puro
     * ------------------------------------------------------------------ */
    {
      name: "domain-no-frameworks",
      severity: "error",
      comment:
        "El dominio no depende de librerías externas. Si necesitas una, es que estás modelando infraestructura.",
      // Los tests colocados junto al dominio sí usan el runner: se excluyen.
      from: { path: "^apps/api/src/modules/[^/]+/domain/", pathNot: "\\.test\\.ts$" },
      to: {
        dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer"],
        pathNot: ["^node_modules/(uuid|zod)/"],
      },
    },
    {
      name: "prisma-only-in-infrastructure",
      severity: "error",
      comment:
        "Prisma solo puede aparecer en infrastructure/persistence, en platform/database o en " +
        "el composition root. El resto del sistema habla con repositorios.",
      from: {
        pathNot: [
          "^apps/api/src/modules/[^/]+/infrastructure/persistence/",
          "^apps/api/src/platform/database/",
          "^apps/api/src/platform/di/",
          "^apps/api/src/bootstrap/",
          "^apps/api/prisma/",
        ],
      },
      to: {
        path: ["^node_modules/(@prisma/client|\\.prisma)/", "^apps/api/src/generated/prisma"],
      },
    },

    /* ------------------------------------------------------------------ *
     * 4. Los canales y proveedores externos son detalles reemplazables
     * ------------------------------------------------------------------ */
    {
      name: "whatsapp-is-only-an-adapter",
      severity: "error",
      comment:
        "PRINCIPIO 2 del documento de arquitectura: WhatsApp es un canal, no lógica de negocio. " +
        "Solo el propio adaptador, el punto de composición del módulo (su index.ts, decisión D9) " +
        "y el composition root pueden referenciarlo.",
      from: {
        pathNot: [
          "^apps/api/src/modules/channels/infrastructure/adapters/whatsapp/",
          "^apps/api/src/modules/channels/index\\.ts$",
          "^apps/api/src/bootstrap/",
        ],
      },
      to: { path: "^apps/api/src/modules/channels/infrastructure/adapters/whatsapp/" },
    },
    {
      name: "property-provider-is-only-an-adapter",
      severity: "error",
      comment:
        "PRINCIPIO 3: no conocemos el origen de los inmuebles. Un adaptador de catálogo solo " +
        "se referencia desde sí mismo, desde el punto de composición del módulo (su index.ts, " +
        "decisión D9), desde sus dobles de prueba y desde el composition root.",
      from: {
        pathNot: [
          "^apps/api/src/modules/catalog/infrastructure/providers/",
          "^apps/api/src/modules/catalog/index\\.ts$",
          "^apps/api/src/modules/catalog/testing/",
          "^apps/api/src/bootstrap/",
        ],
      },
      to: { path: "^apps/api/src/modules/catalog/infrastructure/providers/" },
    },
    {
      name: "llm-sdks-only-in-agent-infrastructure",
      severity: "error",
      comment:
        "PRINCIPIO 4: ningún SDK de IA fuera de agent/infrastructure/llm. El resto usa LLMProvider.",
      from: { pathNot: ["^apps/api/src/modules/agent/infrastructure/llm/"] },
      to: {
        path: "^node_modules/(openai|@anthropic-ai|@google/generative-ai|ollama)/",
      },
    },

    /* ------------------------------------------------------------------ *
     * 5. Higiene general
     * ------------------------------------------------------------------ */
    {
      name: "no-circular",
      severity: "error",
      comment: "Las dependencias circulares hacen imposible extraer un módulo.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "warn",
      from: {
        orphan: true,
        pathNot: ["\\.d\\.ts$", "(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$", "\\.config\\.(js|ts)$"],
      },
      to: {},
    },
    {
      name: "not-to-dev-dep",
      severity: "error",
      comment: "Código de producción no puede importar devDependencies.",
      from: { path: "^apps/api/src/", pathNot: "\\.(test|spec)\\.ts$|/testing/" },
      to: { dependencyTypes: ["npm-dev"] },
    },
    {
      name: "no-deprecated-core",
      severity: "error",
      from: {},
      to: { dependencyTypes: ["core"], path: "^(punycode|domain|sys|querystring)$" },
    },
  ],

  options: {
    // El cliente generado de Prisma no se recorre, pero sí se ve: así la regla
    // `prisma-only-in-infrastructure` puede detectar quién lo importa.
    doNotFollow: { path: "node_modules|^apps/api/src/generated/" },
    // Sin `tsConfig`: no usamos alias de rutas. Los imports dentro de un módulo
    // son relativos, de modo que el módulo es portable tal cual.
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".js", ".json"],
    },
    reporterOptions: {
      dot: { collapsePattern: "^apps/api/src/(platform|modules/[^/]+)" },
      archi: { collapsePattern: "^apps/api/src/(platform|modules/[^/]+)" },
    },
  },
};

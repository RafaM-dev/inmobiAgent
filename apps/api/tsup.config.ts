import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    main: "src/main.ts",
    worker: "src/bootstrap/worker.ts",
    // Paso de despliegue: provisionar rol, migrar y recrear índices. Va como
    // entrada propia para que la imagen pueda ejecutarlo sin `tsx` ni fuentes.
    release: "src/bootstrap/release.ts",
    // Alta de una inmobiliaria en un despliegue real. Va en el bundle porque
    // `tsx` no existe en la imagen de producción, y sin este comando no habría
    // forma de entrar en lo que se acaba de desplegar.
    onboard: "src/bootstrap/onboard.ts",
  },
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  // Las dependencias de node_modules quedan externas: Prisma y los drivers
  // nativos no deben empaquetarse.
  skipNodeModulesBundle: true,
  /*
   * …salvo los paquetes del propio workspace, que SÍ se empaquetan.
   *
   * `@agentinmobi/contracts` se publica como fuente TypeScript (`exports`
   * apunta a `src/index.ts`), así que dejarlo externo producía un bundle que
   * pedía a Node importar un `.ts` en tiempo de ejecución. El build salía
   * «correcto» y el proceso moría al arrancar con un ERR_MODULE_NOT_FOUND que
   * no menciona TypeScript por ningún lado.
   *
   * No se detectó antes porque en desarrollo corre `tsx`, que sí entiende
   * TypeScript: el fallo solo existía en el artefacto que nadie ejecutaba
   * todavía.
   */
  noExternal: [/^@agentinmobi\//],
  /*
   * El cliente generado de Prisma NO se empaqueta.
   *
   * Vive bajo `src/` —lo pone ahí el generador— así que se importa con rutas
   * relativas y el bundler intentaría meterlo dentro. Es CommonJS y usa
   * `require` dinámico para cargar su motor de consultas, cosa que un bundle
   * ESM no puede resolver: el proceso muere al arrancar con
   * «Dynamic require of "fs" is not supported».
   */
  external: [/generated\/prisma/],
});

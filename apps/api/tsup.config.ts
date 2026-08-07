import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    main: "src/main.ts",
    worker: "src/bootstrap/worker.ts",
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
});

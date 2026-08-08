import { execFileSync, spawnSync } from "node:child_process";

/**
 * Cómo se invocan `pg_dump` y `pg_restore` en esta máquina.
 *
 * Hay dos mundos y el script tiene que funcionar en los dos:
 *
 *  - **Desarrollo.** Postgres corre en un contenedor y casi nadie tiene las
 *    herramientas cliente instaladas en el host. Las de dentro del contenedor
 *    sí están, y además con la versión exacta del servidor.
 *  - **Producción.** Postgres es un servicio gestionado o una máquina aparte, y
 *    quien hace el backup tiene `pg_dump` instalado.
 *
 * Se prefieren SIEMPRE las herramientas locales si existen. `pg_dump` se niega
 * a volcar un servidor de versión mayor que la suya, así que usar las del
 * propio contenedor es también la forma de no tener nunca ese problema en
 * desarrollo.
 */

export interface PgRunner {
  readonly kind: "local" | "docker";
  readonly description: string;
  /**
   * URL tal como la ve quien ejecuta la herramienta.
   *
   * Dentro del contenedor, el `localhost:5433` del host es `localhost:5432`:
   * el puerto publicado no existe ahí dentro. Traducirlo es obligatorio y es
   * el fallo que se come media hora la primera vez.
   */
  urlFor(url: string): string;
  /** Ejecuta una herramienta cliente y devuelve su salida estándar. */
  run(tool: string, args: readonly string[], options?: { stdout?: "pipe" | "inherit" }): Buffer;
  /** Ejecuta volcando la salida binaria a un fichero del host. */
  runToFile(tool: string, args: readonly string[], filePath: string): void;
  /** Copia un fichero del host al sitio donde la herramienta puede leerlo. */
  stage(filePath: string): string;
  /** Limpia lo que `stage` haya dejado. */
  unstage(stagedPath: string): void;
}

/**
 * Parámetros que libpq entiende. Todo lo demás se descarta.
 *
 * La URL del `.env` la escribe Prisma, y Prisma añade cosas suyas —`schema`,
 * `connection_limit`, `pgbouncer`— que las herramientas cliente **rechazan con
 * un error**, no ignoran. Una lista blanca y no una negra: un parámetro nuevo
 * de Prisma se descarta solo, y uno de libpq que falte se ve en seguida.
 *
 * Descartar `schema` es además lo correcto para una copia: sin `--schema`,
 * `pg_dump` vuelca la base entera, que es justo lo que se quiere respaldar.
 */
const LIBPQ_PARAMS = new Set([
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "sslpassword",
  "channel_binding",
  "connect_timeout",
  "application_name",
  "target_session_attrs",
  "options",
  "passfile",
]);

/** URL de conexión que aceptan `pg_dump`, `pg_restore` y `psql`. */
export const toLibpqUrl = (url: string): string => {
  const clean = new URL(url);
  for (const key of [...clean.searchParams.keys()]) {
    if (!LIBPQ_PARAMS.has(key)) clean.searchParams.delete(key);
  }
  return clean.toString();
};

const CONTAINER = process.env["PG_CONTAINER"] ?? "agentinmobi-postgres";
/** Puerto del servidor DENTRO del contenedor, no el publicado en el host. */
const CONTAINER_PORT = process.env["PG_CONTAINER_PORT"] ?? "5432";

const exists = (command: string, args: readonly string[]): boolean => {
  const result = spawnSync(command, args, { stdio: "ignore", shell: process.platform === "win32" });
  return result.status === 0;
};

const localRunner = (): PgRunner => ({
  kind: "local",
  description: "herramientas cliente del host",
  urlFor: (url) => toLibpqUrl(url),
  run: (tool, args, options) =>
    execFileSync(tool, [...args], {
      stdio: ["ignore", options?.stdout ?? "pipe", "pipe"],
      shell: process.platform === "win32",
      maxBuffer: 512 * 1024 * 1024,
    }),
  runToFile: (tool, args, filePath) => {
    execFileSync(tool, [...args, "--file", filePath], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
  },
  stage: (filePath) => filePath,
  unstage: () => undefined,
});

const dockerRunner = (): PgRunner => {
  /** `/tmp` del contenedor: es Linux siempre, sea cual sea el host. */
  const staging = (name: string): string => `/tmp/${name}`;

  return {
    kind: "docker",
    description: `herramientas del contenedor ${CONTAINER}`,

    urlFor: (url) => {
      const inside = new URL(toLibpqUrl(url));
      inside.hostname = "localhost";
      inside.port = CONTAINER_PORT;
      return inside.toString();
    },

    run: (tool, args, options) =>
      execFileSync("docker", ["exec", "-i", CONTAINER, tool, ...args], {
        stdio: ["ignore", options?.stdout ?? "pipe", "pipe"],
        maxBuffer: 512 * 1024 * 1024,
      }),

    runToFile: (tool, args, filePath) => {
      const inner = staging(`agentinmobi-${String(process.pid)}.tmp`);
      execFileSync("docker", ["exec", "-i", CONTAINER, tool, ...args, "--file", inner], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      // `docker cp` y no una tubería: en Windows, redirigir binario por la
      // salida estándar de `docker exec` corrompe el volcado con conversiones
      // de fin de línea. Un fichero copiado llega byte a byte.
      execFileSync("docker", ["cp", `${CONTAINER}:${inner}`, filePath], { stdio: "pipe" });
      execFileSync("docker", ["exec", CONTAINER, "rm", "-f", inner], { stdio: "pipe" });
    },

    stage: (filePath) => {
      const inner = staging(`agentinmobi-restore-${String(process.pid)}.dump`);
      execFileSync("docker", ["cp", filePath, `${CONTAINER}:${inner}`], { stdio: "pipe" });
      return inner;
    },

    unstage: (stagedPath) => {
      execFileSync("docker", ["exec", CONTAINER, "rm", "-f", stagedPath], { stdio: "pipe" });
    },
  };
};

export const resolveRunner = (): PgRunner => {
  if (exists("pg_dump", ["--version"])) return localRunner();

  if (exists("docker", ["exec", CONTAINER, "pg_dump", "--version"])) return dockerRunner();

  throw new Error(
    "No se encuentra `pg_dump`.\n" +
      "  · Instala las herramientas cliente de PostgreSQL, o\n" +
      `  · levanta la infraestructura con \`pnpm infra:up\` (usa las del contenedor ${CONTAINER}).\n` +
      "Con PG_CONTAINER puedes apuntar a otro contenedor.",
  );
};

/** `postgresql://…/agentinmobi` → `agentinmobi` */
export const databaseNameOf = (url: string): string => new URL(url).pathname.replace(/^\//, "");

/** La misma URL apuntando a otra base. Para crear y borrar bases de trabajo. */
export const withDatabase = (url: string, database: string): string => {
  const target = new URL(url);
  target.pathname = `/${database}`;
  return target.toString();
};

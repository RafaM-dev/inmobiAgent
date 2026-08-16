import { PrismaClient } from "@prisma/client";

/**
 * Provisiona el rol con el que la aplicación se conecta.
 *
 * **Sin esto, Row Level Security no protege absolutamente nada.**
 *
 * Un superusuario de PostgreSQL se salta TODAS las políticas de RLS, incluso
 * con `FORCE ROW LEVEL SECURITY`. El usuario que crea `docker compose` —y el de
 * casi cualquier Postgres recién instalado— es superusuario. Activar las
 * políticas y seguir conectando con él da una falsa sensación de seguridad
 * perfecta: las políticas existen, los tests de aislamiento pasan por el filtro
 * del código, y ninguna hace nada.
 *
 * Lo destapó un test que insertaba filas de dos inmobiliarias y contaba sin
 * filtrar: salían las tres.
 *
 * Es idempotente y corre antes de cada migración. Conecta como administrador
 * (`DATABASE_ADMIN_URL`) y deja listo un rol **sin** superusuario y **sin**
 * `BYPASSRLS`, que es el de `DATABASE_URL`.
 */

/**
 * Identificador SQL entrecomillado.
 *
 * El nombre del rol sale de nuestra propia URL de conexión, no de una entrada
 * externa, pero se escapa igualmente: un identificador interpolado a pelo es la
 * clase de atajo que sobrevive hasta que alguien parametriza el despliegue.
 */
const ident = (value: string): string => `"${value.replace(/"/g, '""')}"`;

/**
 * `unaccent` TIENE que estar en `public`, y no por gusto.
 *
 * La migración de `knowledge` la invoca cualificada —`public.unaccent(
 * 'public.unaccent', $1)`— porque necesita fijar el diccionario para que la
 * función sea IMMUTABLE y quepa en una columna generada. Es lo que hace que
 * "Medellin" encuentre "Medellín", o sea la mitad de las búsquedas en español.
 *
 * En un Postgres recién instalado las extensiones caen en `public` y esto no
 * hace nada. Supabase las pone en `extensions`, y entonces esa migración muere
 * con «function public.unaccent(unknown, text) does not exist» — un error que
 * no menciona esquemas y manda a buscar donde no es.
 *
 * Mover la extensión arrastra consigo la función y el diccionario, que son las
 * dos cosas que la migración nombra. Si no se puede mover, se avisa aquí en vez
 * de dejar que reviente después: el mensaje sale antes de tocar nada.
 *
 * Lo correcto a futuro es que ninguna migración cualifique el esquema de una
 * extensión. Esta no se puede reescribir sin invalidar las bases donde ya está
 * aplicada, así que se compensa aquí.
 */
const ensureUnaccentInPublic = async (admin: PrismaClient): Promise<void> => {
  const rows = await admin.$queryRawUnsafe<{ nspname: string }[]>(
    `SELECT n.nspname FROM pg_extension e
       JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'unaccent'`,
  );
  const home = rows[0]?.nspname;
  if (home === undefined || home === "public") return;

  try {
    await admin.$executeRawUnsafe("ALTER EXTENSION unaccent SET SCHEMA public");
  } catch (cause) {
    throw new Error(
      `La extensión "unaccent" está en el esquema "${home}" y no se ha podido mover ` +
        `a "public": ${cause instanceof Error ? cause.message : String(cause)}\n` +
        "Las migraciones la invocan como `public.unaccent`. Muévela a mano con " +
        "`ALTER EXTENSION unaccent SET SCHEMA public` desde un usuario que la posea.",
    );
  }
};

/**
 * Con qué rol acaba conectando de verdad la aplicación, o `null` si todavía no
 * puede conectar. Es la única forma fiable de saberlo cuando hay un agrupador
 * de conexiones de por medio, que reescribe el nombre de usuario.
 */
const effectiveRole = async (appUrl: string): Promise<string | null> => {
  const client = new PrismaClient({ datasources: { db: { url: appUrl } } });
  try {
    const rows = await client.$queryRawUnsafe<{ current_user: string }[]>("SELECT current_user");
    return rows[0]?.current_user ?? null;
  } catch {
    return null;
  } finally {
    await client.$disconnect();
  }
};
const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export interface ProvisionResult {
  readonly role: string;
  readonly created: boolean;
  /** `true` si la aplicación se conecta con un rol que se salta RLS. */
  readonly bypassesRls: boolean;
  readonly message: string;
}

export const provisionAppRole = async (input: {
  adminUrl: string;
  appUrl: string;
}): Promise<ProvisionResult> => {
  const parsed = new URL(input.appUrl);
  const username = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const database = parsed.pathname.replace(/^\//, "");

  if (username.length === 0 || password.length === 0) {
    throw new Error("La URL de la aplicación debe incluir usuario y contraseña.");
  }

  /*
   * El usuario de la URL NO siempre es el rol de PostgreSQL.
   *
   * Los agrupadores de conexiones lo decoran para saber a qué proyecto van:
   * Supabase pide `postgres.abcdefgh…` y por dentro conecta como `postgres`.
   * Deducir el rol del nombre de usuario creó una vez un rol llamado
   * literalmente `postgres.wgvjwkj…`, con sus permisos y su `search_path`, que
   * después costó más quitar que poner.
   *
   * Se pregunta a la base con esas mismas credenciales: si conectan, el rol
   * verdadero es lo que responda `current_user`, decorado o no. Si no conectan,
   * es que aún no existe y hay que crearlo — y entonces sí sirve el nombre de
   * la URL, que en ese caso no puede venir decorado.
   */
  const role = (await effectiveRole(input.appUrl)) ?? username;

  if (role.includes(".")) {
    throw new Error(
      `No se puede crear un rol llamado "${role}": ese punto lo añade el ` +
        "agrupador de conexiones, no es parte del nombre. Apunta DATABASE_URL a " +
        "una conexión directa para crear el rol, o usa el mismo usuario que " +
        "DATABASE_ADMIN_URL.",
    );
  }

  const admin = new PrismaClient({ datasources: { db: { url: input.adminUrl } } });

  try {
    const rows = await admin.$queryRawUnsafe<{ current_user: string; usesuper: boolean }[]>(
      "SELECT current_user, usesuper FROM pg_user WHERE usename = current_user",
    );
    const adminRole = rows[0]?.current_user ?? "";
    const adminIsSuper = rows[0]?.usesuper ?? false;

    /*
     * Las extensiones, ANTES de decidir si hace falta crear un rol. Se necesitan
     * en los dos caminos: cuando la aplicación tiene rol propio y cuando reutiliza
     * el del administrador —el caso de los Postgres gestionados que no dejan
     * autenticar roles nuevos a través de su agrupador de conexiones—.
     */
    for (const extension of ["vector", "unaccent", "pg_trgm", "pgcrypto"]) {
      await admin.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS ${ident(extension)}`);
    }
    await ensureUnaccentInPublic(admin);

    if (adminRole === role) {
      // La aplicación se conecta con el mismo rol que administra. Si además es
      // superusuario, RLS es decorativo — y hay que decirlo, no dejarlo pasar.
      return {
        role,
        created: false,
        bypassesRls: adminIsSuper,
        message: adminIsSuper
          ? `El rol "${role}" es SUPERUSUARIO: se salta todas las políticas de RLS.`
          : `El rol "${role}" no es superusuario: RLS se aplica sobre las tablas. Nada que crear.`,
      };
    }

    const existing = await admin.$queryRawUnsafe<{ ok: boolean }[]>(
      "SELECT true AS ok FROM pg_roles WHERE rolname = $1",
      role,
    );
    const created = existing.length === 0;

    /*
     * Los atributos se reafirman aunque el rol ya exista. Un `BYPASSRLS` puesto
     * "para depurar" y olvidado desactiva el aislamiento entero sin que nada lo
     * señale; esto lo revierte en la siguiente migración.
     */
    await admin.$executeRawUnsafe(
      created
        ? `CREATE ROLE ${ident(role)} LOGIN PASSWORD ${literal(password)} NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`
        : `ALTER ROLE ${ident(role)} LOGIN PASSWORD ${literal(password)} NOSUPERUSER NOBYPASSRLS`,
    );

    /*
     * Las migraciones corren con ESTE rol, y en PostgreSQL solo el DUEÑO de una
     * tabla puede alterarla. En una base creada desde cero no hay problema —las
     * crea él y son suyas—, pero en una que existía ANTES de separar los roles
     * (D55) son del administrador, y la siguiente migración que toque una tabla
     * vieja muere con «must be owner of table». Le pasó a la base de desarrollo
     * de este repositorio.
     *
     * Reasignar el dueño NO abre un agujero en el aislamiento, y ese es
     * justamente el motivo de que las políticas se declaren con **FORCE**: sin
     * él, el dueño de una tabla se salta su propia RLS. Con él, no. Es la misma
     * decisión de D54 sosteniendo un caso que entonces no se había visto.
     */
    const reassigned = await admin.$executeRawUnsafe(`
      DO $reassign$
      DECLARE
        target text := ${literal(role)};
        obj record;
      BEGIN
        FOR obj IN
          SELECT c.relname AS name,
                 CASE c.relkind
                   WHEN 'r' THEN 'TABLE'
                   WHEN 'p' THEN 'TABLE'
                   WHEN 'S' THEN 'SEQUENCE'
                   WHEN 'v' THEN 'VIEW'
                   WHEN 'm' THEN 'MATERIALIZED VIEW'
                 END AS kind
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public'
             AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
             AND pg_get_userbyid(c.relowner) <> target
        LOOP
          EXECUTE format('ALTER %s public.%I OWNER TO %I', obj.kind, obj.name, target);
        END LOOP;
      END
      $reassign$;
    `);
    void reassigned;

    /*
     * Dónde viven de verdad las extensiones, en vez de suponer que en `public`.
     *
     * En un Postgres recién instalado caen en `public` y esto no hace nada. En
     * Supabase —y en varios gestionados— van a un esquema aparte, y entonces el
     * rol de la aplicación **no encuentra el tipo `vector`**: la migración muere
     * con «type "vector" does not exist», un error que no menciona esquemas por
     * ningún lado y manda a buscar en la dirección equivocada.
     *
     * Se descubre consultando, no con una lista escrita a mano: así funciona
     * igual en Supabase, en RDS o en el contenedor de desarrollo.
     */
    const homes = await admin.$queryRawUnsafe<{ nspname: string }[]>(
      `SELECT DISTINCT n.nspname
         FROM pg_extension e
         JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname IN ('vector', 'unaccent', 'pg_trgm', 'pgcrypto')
          AND n.nspname <> 'public'`,
    );
    const extensionSchemas = homes.map((row) => row.nspname);

    for (const schema of extensionSchemas) {
      await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA ${ident(schema)} TO ${ident(role)}`);
    }

    /*
     * El `search_path` se fija en el ROL y no en la conexión: así lo heredan las
     * migraciones, el proceso de la API y cualquier `psql` que alguien abra con
     * este usuario. Fijarlo en la cadena de conexión dejaría fuera justo al que
     * más lo necesita — el que corre las migraciones.
     */
    await admin.$executeRawUnsafe(
      `ALTER ROLE ${ident(role)} SET search_path = ${["public", ...extensionSchemas]
        .map(ident)
        .join(", ")}`,
    );

    for (const statement of [
      `GRANT CONNECT ON DATABASE ${ident(database)} TO ${ident(role)}`,
      `GRANT USAGE, CREATE ON SCHEMA public TO ${ident(role)}`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ident(role)}`,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ident(role)}`,
      // Para las tablas que creen las migraciones futuras, que corren con este
      // mismo rol; y para las que cree el administrador, por si acaso.
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ident(role)}`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${ident(role)}`,
    ]) {
      await admin.$executeRawUnsafe(statement);
    }

    return {
      role,
      created,
      bypassesRls: false,
      message:
        `${created ? "Rol creado" : "Rol ya existía"} y permisos concedidos sobre "${database}"` +
        (extensionSchemas.length > 0
          ? `. Extensiones en ${extensionSchemas.join(", ")}: añadidas al search_path.`
          : "."),
    };
  } finally {
    await admin.$disconnect();
  }
};

/* -------------------------------------------------------------------------- *
 * CLI
 * -------------------------------------------------------------------------- */

const isCli = process.argv[1]?.includes("provision-db-role") ?? false;

if (isCli) {
  const appUrl = process.env["DATABASE_URL"];
  const adminUrl = process.env["DATABASE_ADMIN_URL"] ?? appUrl;

  if (!appUrl || !adminUrl) {
    console.error("Falta DATABASE_URL (y opcionalmente DATABASE_ADMIN_URL).");
    process.exit(1);
  }

  provisionAppRole({ adminUrl, appUrl })
    .then((result) => {
      if (result.bypassesRls) {
        console.error(
          `\n⚠  ${result.message}\n` +
            "   Define DATABASE_ADMIN_URL con el superusuario y deja DATABASE_URL\n" +
            "   apuntando a un rol distinto; este script lo crea.\n",
        );
        process.exit(1);
      }
      console.log(`✔ ${result.message}`);
    })
    .catch((error: unknown) => {
      console.error(
        "Fallo al provisionar el rol:",
        error instanceof Error ? error.message : error,
      );
      process.exit(1);
    });
}

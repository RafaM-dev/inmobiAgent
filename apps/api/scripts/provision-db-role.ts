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
  const role = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const database = parsed.pathname.replace(/^\//, "");

  if (role.length === 0 || password.length === 0) {
    throw new Error("La URL de la aplicación debe incluir usuario y contraseña.");
  }

  const admin = new PrismaClient({ datasources: { db: { url: input.adminUrl } } });

  try {
    const rows = await admin.$queryRawUnsafe<{ current_user: string; usesuper: boolean }[]>(
      "SELECT current_user, usesuper FROM pg_user WHERE usename = current_user",
    );
    const adminRole = rows[0]?.current_user ?? "";
    const adminIsSuper = rows[0]?.usesuper ?? false;

    if (adminRole === role) {
      // La aplicación se conecta con el mismo rol que administra. Si además es
      // superusuario, RLS es decorativo — y hay que decirlo, no dejarlo pasar.
      return {
        role,
        created: false,
        bypassesRls: adminIsSuper,
        message: adminIsSuper
          ? `El rol "${role}" es SUPERUSUARIO: se salta todas las políticas de RLS.`
          : `El rol "${role}" no es superusuario: RLS se aplica. Nada que hacer.`,
      };
    }

    // Las extensiones las crea el administrador: `CREATE EXTENSION` sí exige
    // superusuario. Después, las migraciones se las encuentran hechas.
    for (const extension of ["vector", "unaccent", "pg_trgm", "pgcrypto"]) {
      await admin.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS ${ident(extension)}`);
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
      message: `${created ? "Rol creado" : "Rol ya existía"} y permisos concedidos sobre "${database}".`,
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

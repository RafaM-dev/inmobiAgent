import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RLS_EXCLUDED_TABLES, RLS_PROTECTED_TABLES } from "../../prisma/rls/tables";
import { asTenant } from "../support/fixtures";
import { withDatabase, type DatabaseContext } from "../support/integration-harness";

/**
 * ROW LEVEL SECURITY: la tercera capa de aislamiento entre inmobiliarias.
 *
 * Las dos primeras —`TenantContext` y `tenantScope()` en cada repositorio—
 * dependen de que el código no se olvide, y ya se demostró que puede: un
 * `findById` sin ámbito sobrevivió seis fases. Lo que se comprueba aquí es que
 * la base se niega **aunque el código se equivoque**.
 *
 * Por eso los tests usan SQL crudo sin ningún filtro por tenant. No es pereza:
 * es simular exactamente el descuido contra el que esta capa protege.
 */
describe("Row Level Security (Postgres real)", () => {
  let context: DatabaseContext;

  const insertContact = (tenantId: string, id: string) =>
    asTenant(tenantId, () =>
      context.database.run(async () => {
        await context.database.client().$executeRaw`
          INSERT INTO contacts (id, tenant_id, display_name, created_at, updated_at)
          VALUES (${id}, ${tenantId}, ${"Cliente " + id}, now(), now())
        `;
      }),
    );

  /** Consulta SIN filtro por tenant: el descuido que esto debe atajar. */
  const countAllContacts = (tenantId: string) =>
    asTenant(tenantId, () =>
      context.database.run(async () => {
        const rows = await context.database.client().$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM contacts
        `;
        return Number(rows[0]?.n ?? 0);
      }),
    );

  beforeAll(async () => {
    context = await withDatabase();
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
  });

  it("una consulta sin filtro solo ve las filas de su inmobiliaria", async () => {
    await insertContact("alfa", "c-alfa-1");
    await insertContact("alfa", "c-alfa-2");
    await insertContact("beta", "c-beta-1");

    /*
     * `SELECT count(*) FROM contacts` — sin un solo `WHERE`. Si RLS no
     * estuviera activo, esto devolvería 3 desde cualquier contexto.
     */
    expect(await countAllContacts("alfa")).toBe(2);
    expect(await countAllContacts("beta")).toBe(1);
  });

  it("sin contexto de tenant no se ve NADA: la política falla cerrada", async () => {
    await insertContact("alfa", "c-alfa-1");

    const rows = await context.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM contacts
    `;

    /*
     * Un olvido produce cero resultados, nunca los de otra inmobiliaria. Es la
     * diferencia entre una función que se queda sin datos —y se nota— y una que
     * devuelve los de un cliente equivocado.
     */
    expect(Number(rows[0]?.n ?? -1)).toBe(0);
  });

  it("no deja escribir una fila de otra inmobiliaria", async () => {
    /*
     * `WITH CHECK` cubre el otro lado: no basta con no poder LEER lo ajeno,
     * tampoco se puede ESCRIBIR con el `tenant_id` de otro.
     */
    await expect(
      asTenant("alfa", () =>
        context.database.run(async () => {
          await context.database.client().$executeRaw`
            INSERT INTO contacts (id, tenant_id, display_name, created_at, updated_at)
            VALUES ('c-robado', 'beta', 'Cliente de Beta', now(), now())
          `;
        }),
      ),
    ).rejects.toThrow();
  });

  it("no deja borrar ni modificar lo de otra inmobiliaria", async () => {
    await insertContact("beta", "c-beta-1");

    const borradas = await asTenant("alfa", () =>
      context.database.run(async () =>
        context.database.client().$executeRaw`DELETE FROM contacts WHERE id = 'c-beta-1'`,
      ),
    );

    // Cero filas afectadas: para Alfa, esa fila no existe.
    expect(borradas).toBe(0);
    expect(await countAllContacts("beta")).toBe(1);
  });

  it("el comodín abre la puerta, pero hay que escribirlo", async () => {
    await insertContact("alfa", "c-alfa-1");
    await insertContact("beta", "c-beta-1");

    const total = await context.database.runAcrossTenants("test de mantenimiento", async (tx) => {
      const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM contacts`;
      return Number(rows[0]?.n ?? 0);
    });

    // Cruzar la frontera es posible —el seed y el mantenimiento lo necesitan—
    // pero exige decirlo, y `grep` encuentra cada sitio que lo hace.
    expect(total).toBe(2);
  });

  it("el ajuste no se queda pegado a la conexión del pool", async () => {
    await insertContact("alfa", "c-alfa-1");

    // Una consulta con contexto…
    expect(await countAllContacts("alfa")).toBe(1);

    /*
     * …y otra sin él, que muy probablemente reutiliza la misma conexión. Con
     * `SET` de sesión en vez de `SET LOCAL`, esta segunda heredaría el tenant
     * de la anterior y devolvería 1 — datos ajenos, el fallo PEOR que no tener
     * RLS.
     */
    const rows = await context.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM contacts
    `;
    expect(Number(rows[0]?.n ?? -1)).toBe(0);
  });

  describe("cobertura", () => {
    it("todas las tablas declaradas tienen RLS activo Y forzado", async () => {
      const rows = await context.prisma.$queryRaw<
        { tablename: string; rowsecurity: boolean; relforcerowsecurity: boolean }[]
      >`
        SELECT c.relname AS tablename, c.relrowsecurity AS rowsecurity,
               c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
      `;

      const byName = new Map(rows.map((row) => [row.tablename, row]));

      for (const table of RLS_PROTECTED_TABLES) {
        const row = byName.get(table);
        expect(row, `la tabla ${table} no existe`).toBeDefined();
        expect(row?.rowsecurity, `${table} sin RLS`).toBe(true);
        /*
         * FORCE es el detalle que separa una protección real de una decorativa:
         * sin él, el DUEÑO de la tabla se salta la política — y la aplicación
         * se conecta con el usuario que creó las tablas.
         */
        expect(row?.relforcerowsecurity, `${table} sin FORCE`).toBe(true);
      }
    });

    it("ninguna tabla con tenant_id se queda fuera sin justificar", async () => {
      const rows = await context.prisma.$queryRaw<{ tablename: string }[]>`
        SELECT c.relname AS tablename
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND a.attname = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped
      `;

      const declared = new Set<string>([
        ...RLS_PROTECTED_TABLES,
        ...Object.keys(RLS_EXCLUDED_TABLES),
      ]);

      const forgotten = rows.map((row) => row.tablename).filter((name) => !declared.has(name));

      /*
       * Este test es el que mantiene viva la lista: una tabla nueva con
       * `tenant_id` que nadie protegió ni excluyó rompe el build, en vez de
       * quedarse abierta durante fases sin que nadie lo note.
       */
      expect(forgotten).toEqual([]);
    });
  });
});

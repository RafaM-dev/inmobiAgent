import type { AppCradle } from "../../src/bootstrap/container";
import { isErr } from "../../src/platform/result/result";
import { TenantContext } from "../../src/platform/tenancy/tenant-context";
import { ChannelType } from "../../src/modules/channels";

/**
 * Escenarios de prueba construidos con los CASOS DE USO reales, no con
 * `prisma.create()`.
 *
 * Escribir las filas a mano produciría estados que la aplicación nunca genera
 * —un tenant sin propietario, una cuenta de canal sin capacidades— y los tests
 * pasarían a describir un mundo imaginario. Aquí se paga un poco más de tiempo
 * a cambio de que el punto de partida sea uno alcanzable de verdad.
 */

export interface SeededTenant {
  readonly tenantId: string;
  readonly slug: string;
  readonly email: string;
  readonly password: string;
  readonly consoleAccountExternalId: string;
}

let counter = 0;

/** Un tenant completo: inmobiliaria, asesor con contraseña y canal de consola. */
export const seedTenant = async (
  cradle: AppCradle,
  options: { slug?: string; name?: string } = {},
): Promise<SeededTenant> => {
  counter += 1;
  const slug = options.slug ?? `inmobiliaria-test-${String(counter)}`;
  const email = `asesor@${slug}.co`;
  const password = "contrasena-de-pruebas-2026";

  const created = await cradle.createTenant.execute({
    slug,
    name: options.name ?? `Inmobiliaria ${String(counter)}`,
    owner: { email, displayName: "Asesor de pruebas" },
  });
  if (isErr(created)) throw created.error;

  const withPassword = await cradle.setUserPassword.execute({
    tenantId: created.value.id,
    email,
    password,
  });
  if (isErr(withPassword)) throw withPassword.error;

  const consoleAccountExternalId = `consola-${String(counter)}`;

  await TenantContext.run(
    { tenantId: created.value.id, correlationId: `test-${String(counter)}`, source: "cli" },
    async () => {
      const account = await cradle.registerChannelAccount.execute({
        channelType: ChannelType.CONSOLE,
        externalId: consoleAccountExternalId,
        displayName: "Consola de pruebas",
      });
      if (isErr(account)) throw account.error;
    },
  );

  return {
    tenantId: created.value.id,
    slug,
    email,
    password,
    consoleAccountExternalId,
  };
};

/** Ejecuta algo dentro del contexto de un tenant, como hace el guardia HTTP. */
export const asTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
  TenantContext.run({ tenantId, correlationId: "test", source: "cli" }, fn);

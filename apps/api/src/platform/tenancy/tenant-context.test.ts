import { describe, expect, it } from "vitest";
import { ErrorCode } from "../errors/error-codes";
import { AppError } from "../errors/app-error";
import { assertSameTenant, TenantContext, type ExecutionContext } from "./tenant-context";

const ctx: ExecutionContext = {
  tenantId: "inmobiliaria-abc",
  correlationId: "corr-1",
  source: "http",
};

describe("TenantContext", () => {
  it("falla en vez de leer datos sin ámbito de tenant", () => {
    expect(() => TenantContext.require()).toThrow(AppError);
    try {
      TenantContext.require();
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.TENANT_CONTEXT_MISSING);
    }
  });

  it("propaga el contexto a través de límites asíncronos", async () => {
    const seen = await TenantContext.run(ctx, async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      return TenantContext.requireTenantId();
    });

    expect(seen).toBe("inmobiliaria-abc");
  });

  it("aísla contextos concurrentes: dos inmobiliarias en paralelo no se mezclan", async () => {
    const observe = (tenantId: string) =>
      TenantContext.run({ ...ctx, tenantId }, async () => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
        return TenantContext.requireTenantId();
      });

    const results = await Promise.all([observe("t-a"), observe("t-b"), observe("t-c")]);

    expect(results).toEqual(["t-a", "t-b", "t-c"]);
  });

  it("no filtra el contexto fuera del run()", () => {
    TenantContext.run(ctx, () => TenantContext.requireTenantId());
    expect(TenantContext.peek()).toBeUndefined();
  });

  it("assertSameTenant bloquea el acceso a recursos de otro tenant", () => {
    TenantContext.run(ctx, () => {
      expect(() => {
        assertSameTenant("otra-inmobiliaria", "Lead");
      }).toThrow(AppError);

      try {
        assertSameTenant("otra-inmobiliaria", "Lead");
      } catch (error) {
        // 404 y no 403: no revelamos que el recurso existe.
        expect((error as AppError).httpStatus).toBe(404);
        expect((error as AppError).code).toBe(ErrorCode.TENANT_MISMATCH);
      }

      expect(() => {
        assertSameTenant("inmobiliaria-abc", "Lead");
      }).not.toThrow();
    });
  });
});

import { z } from "zod";

export const dependencyStatusSchema = z.object({
  name: z.string(),
  status: z.enum(["up", "down", "degraded"]),
  latencyMs: z.number().optional(),
  detail: z.string().optional(),
});
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded", "error"]),
  version: z.string(),
  environment: z.string(),
  uptimeSeconds: z.number(),
  dependencies: z.array(dependencyStatusSchema),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

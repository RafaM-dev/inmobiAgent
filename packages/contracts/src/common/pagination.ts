import { z } from "zod";

/**
 * Paginación por cursor (no por offset): estable ante inserciones concurrentes
 * y con coste constante en tablas grandes como `messages`.
 */
export const cursorPageRequestSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CursorPageRequest = z.infer<typeof cursorPageRequestSchema>;

export const cursorPageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

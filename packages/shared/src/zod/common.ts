import { z } from "zod";

export const PAGINATION_DEFAULT_LIMIT = 20;
export const PAGINATION_MAX_LIMIT = 100;

/** Query-параметры cursor-пагинации: ?cursor=...&limit=20 */
export const cursorQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

/** Обёртка постраничного ответа: { items, nextCursor } (nextCursor = null, если данных больше нет) */
export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}
export type Paginated<T> = { items: T[]; nextCursor: string | null };

/** Идентификатор сущности (cuid) */
export const idSchema = z.string().min(1).max(64);

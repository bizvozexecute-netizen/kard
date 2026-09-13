import { describe, expect, it } from "vitest";
import { z } from "zod";
import { cursorQuerySchema, paginatedSchema, PAGINATION_DEFAULT_LIMIT } from "./common";

describe("cursorQuerySchema", () => {
  it("подставляет limit по умолчанию", () => {
    expect(cursorQuerySchema.parse({})).toEqual({ limit: PAGINATION_DEFAULT_LIMIT });
  });

  it("приводит limit из строки query", () => {
    expect(cursorQuerySchema.parse({ limit: "5", cursor: "abc" })).toEqual({
      limit: 5,
      cursor: "abc",
    });
  });

  it("отклоняет limit вне границ", () => {
    expect(cursorQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(cursorQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(cursorQuerySchema.safeParse({ limit: 1.5 }).success).toBe(false);
  });

  it("отклоняет пустой cursor", () => {
    expect(cursorQuerySchema.safeParse({ cursor: "" }).success).toBe(false);
  });
});

describe("paginatedSchema", () => {
  const schema = paginatedSchema(z.object({ id: z.string() }));

  it("принимает страницу с nextCursor и без", () => {
    expect(schema.parse({ items: [{ id: "1" }], nextCursor: "c" }).nextCursor).toBe("c");
    expect(schema.parse({ items: [], nextCursor: null }).nextCursor).toBeNull();
  });

  it("требует nextCursor явно", () => {
    expect(schema.safeParse({ items: [] }).success).toBe(false);
  });
});

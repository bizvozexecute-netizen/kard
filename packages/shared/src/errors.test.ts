import { describe, expect, it } from "vitest";
import { apiErrorSchema, ErrorCode, errorCodeSchema } from "./errors";

describe("ErrorCode", () => {
  it("содержит все коды из ТЗ", () => {
    const required = [
      "INSUFFICIENT_CREDITS",
      "MODERATION_BLOCKED",
      "PRICE_CHANGED",
      "PROVIDER_TIMEOUT",
      "PROVIDER_ERROR",
      "NSFW_OUTPUT",
      "UPSTREAM_OVERLOAD",
      "NOT_FOUND",
      "UNAUTHORIZED",
      "RATE_LIMITED",
    ];
    for (const code of required) expect(errorCodeSchema.safeParse(code).success).toBe(true);
  });

  it("отклоняет неизвестный код", () => {
    expect(errorCodeSchema.safeParse("SOMETHING_ELSE").success).toBe(false);
  });
});

describe("apiErrorSchema", () => {
  it("валидирует формат ответа с ошибкой", () => {
    const ok = apiErrorSchema.safeParse({
      error: { code: ErrorCode.NOT_FOUND, message: "Не найдено", details: { id: "x" } },
    });
    expect(ok.success).toBe(true);
    expect(apiErrorSchema.safeParse({ error: { code: "NOT_FOUND" } }).success).toBe(false);
  });
});

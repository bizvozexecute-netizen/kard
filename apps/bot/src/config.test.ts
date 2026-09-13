import { describe, expect, it } from "vitest";
import { ConfigValidationError, loadConfig } from "./config";

describe("bot loadConfig", () => {
  it("принимает корректный токен", () => {
    expect(loadConfig({ BOT_TOKEN: "123456:ABC-def_ghi" }).BOT_TOKEN).toBe("123456:ABC-def_ghi");
  });

  it("падает без токена и при неверном формате", () => {
    expect(() => loadConfig({})).toThrowError(ConfigValidationError);
    expect(() => loadConfig({ BOT_TOKEN: "nope" })).toThrow(/BOT_TOKEN/);
  });
});

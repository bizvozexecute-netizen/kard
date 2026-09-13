import { describe, expect, it } from "vitest";
import { ConfigValidationError, loadConfig } from "./config";

describe("worker loadConfig", () => {
  it("парсит env с дефолтами", () => {
    const config = loadConfig({ REDIS_URL: "redis://localhost:6379" });
    expect(config).toEqual({
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      REDIS_URL: "redis://localhost:6379",
      WORKER_CONCURRENCY: 4,
    });
  });

  it("падает без REDIS_URL", () => {
    expect(() => loadConfig({})).toThrowError(ConfigValidationError);
    expect(() => loadConfig({})).toThrow(/REDIS_URL: is required/);
  });

  it("ограничивает WORKER_CONCURRENCY", () => {
    expect(() => loadConfig({ REDIS_URL: "redis://x", WORKER_CONCURRENCY: "0" })).toThrow(
      /WORKER_CONCURRENCY/,
    );
  });
});

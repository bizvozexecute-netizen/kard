import { describe, expect, it } from "vitest";
import { ConfigValidationError, loadConfig } from "./config";

const base = {
  DATABASE_URL: "postgresql://kadr:kadr@localhost:5432/kadr",
  REDIS_URL: "redis://localhost:6379",
  FAL_KEY: "fal-test",
  GEMINI_KEY: "gemini-test",
  S3_ENDPOINT: "http://localhost:9000",
  S3_ACCESS_KEY: "minioadmin",
  S3_SECRET_KEY: "minioadmin",
  S3_BUCKET: "kadr",
};

describe("worker loadConfig", () => {
  it("парсит env с дефолтами", () => {
    expect(loadConfig(base)).toEqual({
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      ...base,
      GEMINI_MODEL: "gemini-2.5-flash",
      WORKER_CONCURRENCY: 4,
      LEDGER_RECONCILE_EVERY_MS: 3_600_000,
    });
  });

  it("падает без обязательных переменных, перечисляя их", () => {
    expect(() => loadConfig({})).toThrowError(ConfigValidationError);
    try {
      loadConfig({});
    } catch (err) {
      expect((err as ConfigValidationError).issues).toEqual([
        "DATABASE_URL: is required",
        "REDIS_URL: is required",
        "FAL_KEY: is required",
        "GEMINI_KEY: is required",
        "S3_ENDPOINT: is required",
        "S3_ACCESS_KEY: is required",
        "S3_SECRET_KEY: is required",
        "S3_BUCKET: is required",
      ]);
    }
  });

  it("ограничивает WORKER_CONCURRENCY и период сверки", () => {
    expect(() => loadConfig({ ...base, WORKER_CONCURRENCY: "0" })).toThrow(/WORKER_CONCURRENCY/);
    expect(() => loadConfig({ ...base, LEDGER_RECONCILE_EVERY_MS: "5" })).toThrow(
      /LEDGER_RECONCILE_EVERY_MS/,
    );
  });
});

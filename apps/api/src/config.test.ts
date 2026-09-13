import { describe, expect, it } from "vitest";
import { ConfigValidationError, loadConfig } from "./config";
import { testEnv } from "./test/config.fixture";

describe("loadConfig", () => {
  it("парсит валидный env и подставляет дефолты", () => {
    const { PORT: _port, LOG_LEVEL: _level, ...withoutOptional } = testEnv;
    const config = loadConfig(withoutOptional);
    expect(config.PORT).toBe(3000);
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.DATABASE_URL).toBe(testEnv.DATABASE_URL);
  });

  it("падает при отсутствии обязательной переменной и перечисляет её", () => {
    const { JWT_SECRET: _omit, ...env } = testEnv;
    expect(() => loadConfig(env)).toThrowError(ConfigValidationError);
    try {
      loadConfig(env);
    } catch (err) {
      const e = err as ConfigValidationError;
      expect(e.issues).toEqual(["JWT_SECRET: is required"]);
      expect(e.message).toContain("JWT_SECRET");
    }
  });

  it("проверяет форматы: URL, длина секрета, порт", () => {
    expect(() => loadConfig({ ...testEnv, DATABASE_URL: "not-a-url" })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...testEnv, JWT_SECRET: "short" })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ ...testEnv, PORT: "70000" })).toThrow(/PORT/);
  });

  it("не пропускает NODE_ENV вне списка", () => {
    expect(() => loadConfig({ ...testEnv, NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });
});

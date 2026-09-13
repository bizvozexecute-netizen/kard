import { z } from "zod";

/**
 * Конфиг API. Единственный источник — env. Валидируется при старте;
 * отсутствие обязательной переменной роняет процесс (правило 8 CLAUDE.md).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_PUBLIC_URL: z.string().url(),

  JWT_SECRET: z.string().min(32, "минимум 32 символа"),
  BOT_TOKEN: z.string().min(1),

  FAL_KEY: z.string().min(1),
  GEMINI_KEY: z.string().min(1),

  YOOKASSA_SHOP_ID: z.string().min(1),
  YOOKASSA_SECRET: z.string().min(1),
});

export type AppConfig = z.infer<typeof envSchema>;

export class ConfigValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigValidationError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const key = issue.path.join(".") || "(root)";
      const reason =
        issue.code === "invalid_type" && issue.received === "undefined"
          ? "is required"
          : issue.message;
      return `${key}: ${reason}`;
    });
    throw new ConfigValidationError(issues);
  }
  return result.data;
}

/** DI-токен конфига */
export const CONFIG = Symbol("CONFIG");

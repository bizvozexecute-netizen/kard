import { z } from "zod";

/** Конфиг воркера: подмножество env, нужное процессорам. Валидируется при старте. */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  /** Параллелизм процессора очереди generation */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  /** Период cron-сверки ledger, мс (по умолчанию час) */
  LEDGER_RECONCILE_EVERY_MS: z.coerce.number().int().min(10_000).default(3_600_000),
});

export type WorkerConfig = z.infer<typeof envSchema>;

export class ConfigValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigValidationError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
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

export const CONFIG = Symbol("CONFIG");

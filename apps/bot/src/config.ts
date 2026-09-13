import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  BOT_TOKEN: z.string().regex(/^\d+:[\w-]+$/, "формат <id>:<secret>"),
});

export type BotConfig = z.infer<typeof envSchema>;

export class ConfigValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigValidationError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
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

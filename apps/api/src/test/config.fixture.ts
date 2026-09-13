import { type AppConfig } from "../config";

export const testEnv: Record<string, string> = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  PORT: "3001",
  DATABASE_URL: "postgresql://kadr:kadr@localhost:5432/kadr_test",
  REDIS_URL: "redis://localhost:6379/1",
  S3_ENDPOINT: "http://localhost:9000",
  S3_ACCESS_KEY: "minioadmin",
  S3_SECRET_KEY: "minioadmin",
  S3_BUCKET: "kadr-test",
  S3_PUBLIC_URL: "http://localhost:9000/kadr-test",
  JWT_SECRET: "test-secret-test-secret-test-secret-1234",
  BOT_TOKEN: "123:test",
  FAL_KEY: "fal-test",
  GEMINI_KEY: "gemini-test",
  YOOKASSA_SHOP_ID: "1",
  YOOKASSA_SECRET: "yk-test",
};

export const testConfig: AppConfig = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  PORT: 3001,
  DATABASE_URL: testEnv.DATABASE_URL!,
  REDIS_URL: testEnv.REDIS_URL!,
  S3_ENDPOINT: testEnv.S3_ENDPOINT!,
  S3_ACCESS_KEY: testEnv.S3_ACCESS_KEY!,
  S3_SECRET_KEY: testEnv.S3_SECRET_KEY!,
  S3_BUCKET: testEnv.S3_BUCKET!,
  S3_PUBLIC_URL: testEnv.S3_PUBLIC_URL!,
  JWT_SECRET: testEnv.JWT_SECRET!,
  BOT_TOKEN: testEnv.BOT_TOKEN!,
  FAL_KEY: testEnv.FAL_KEY!,
  GEMINI_KEY: testEnv.GEMINI_KEY!,
  YOOKASSA_SHOP_ID: testEnv.YOOKASSA_SHOP_ID!,
  YOOKASSA_SECRET: testEnv.YOOKASSA_SECRET!,
};

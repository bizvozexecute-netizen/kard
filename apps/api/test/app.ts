import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@kadr/db";
import Redis from "ioredis";
import { inject } from "vitest";
import { AppModule } from "../src/app.module";
import {
  signMiniAppInitData,
  type MiniAppUserFixture,
} from "../src/auth/testing/telegram-fixtures";
import type { AppConfig } from "../src/config";
import { testConfig } from "../src/test/config.fixture";
import { CLOCK } from "../src/users/clock";

export const TEST_BOT_TOKEN = "123456789:AAEexampleBotTokenForTestsOnly_0000000";

export interface TestContext {
  app: INestApplication;
  prisma: PrismaClient;
  redis: Redis;
  /** Управляемое время для тестов стрика */
  clock: { now: Date };
  config: AppConfig;
  close(): Promise<void>;
  reset(): Promise<void>;
  initData(user: MiniAppUserFixture, extra?: { startParam?: string; authDate?: number }): string;
}

export async function createTestApp(): Promise<TestContext> {
  const config: AppConfig = {
    ...testConfig,
    DATABASE_URL: inject("dbUrl"),
    REDIS_URL: inject("redisUrl"),
    BOT_TOKEN: TEST_BOT_TOKEN,
  };
  const clock = { now: new Date("2026-03-01T12:00:00Z") };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
    .overrideProvider(CLOCK)
    .useValue(() => clock.now)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  app.setGlobalPrefix("v1");
  app.set("trust proxy", 1);
  await app.init();

  const prisma = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
  const redis = new Redis(config.REDIS_URL);

  return {
    app,
    prisma,
    redis,
    clock,
    config,
    async reset() {
      await prisma.$executeRawUnsafe(
        'TRUNCATE "daily_claims", "streaks", "ledger_mismatches", "ledger_entries", "credit_accounts", "users" CASCADE',
      );
      await redis.flushdb();
    },
    async close() {
      await app.close();
      await prisma.$disconnect();
      await redis.quit();
    },
    initData(user, extra = {}) {
      return signMiniAppInitData({
        botToken: TEST_BOT_TOKEN,
        user,
        authDate: extra.authDate ?? Math.floor(clock.now.getTime() / 1000),
        startParam: extra.startParam,
      });
    },
  };
}

import { execFileSync } from "node:child_process";
import path from "node:path";

export interface IntegrationSetupOptions {
  postgres?: boolean;
  redis?: boolean;
  /**
   * Имя Postgres-схемы для этого пакета тестов. Разные пакеты (ledger, api) запускаются
   * turbo параллельно на одном TEST_DATABASE_URL — отдельная схема изолирует их данные.
   */
  schema?: string;
  /** Абсолютный путь к пакету с prisma/schema.prisma (по умолчанию packages/db) */
  dbPackageDir?: string;
}

/** Минимальный интерфейс vitest TestProject, чтобы не тянуть vitest в runtime-зависимости */
export interface ProvideTarget {
  provide(key: "dbUrl" | "redisUrl", value: string): void;
}

interface Started {
  url: string;
  stop?: () => Promise<void>;
}

const DEFAULT_DB_PACKAGE_DIR = path.resolve(__dirname, "../../db");

/**
 * Фабрика globalSetup для Vitest: поднимает Postgres и/или Redis для интеграционных тестов.
 *  - TEST_DATABASE_URL / TEST_REDIS_URL заданы → используем их (CI-сервисы, локальные инстансы);
 *  - иначе Testcontainers (postgres:16, redis:7) — нужен Docker.
 * Для Postgres применяет миграции `prisma migrate deploy` из пакета db.
 */
export function createIntegrationGlobalSetup(options: IntegrationSetupOptions = {}) {
  const wantPg = options.postgres ?? true;
  const wantRedis = options.redis ?? false;
  const dbPackageDir = options.dbPackageDir ?? DEFAULT_DB_PACKAGE_DIR;

  return async function globalSetup(project: ProvideTarget): Promise<() => Promise<void>> {
    const stops: Array<() => Promise<void>> = [];

    if (wantPg) {
      const pg = await startPostgres();
      if (pg.stop) stops.push(pg.stop);
      const url = options.schema ? withSchema(pg.url, options.schema) : pg.url;
      migrate(url, dbPackageDir);
      project.provide("dbUrl", url);
    }

    if (wantRedis) {
      const redis = await startRedis();
      if (redis.stop) stops.push(redis.stop);
      project.provide("redisUrl", redis.url);
    }

    return async () => {
      for (const stop of stops.reverse()) await stop();
    };
  };
}

/** Подставляет `?schema=<name>` в URL Postgres (Prisma создаст схему при migrate deploy). */
export function withSchema(url: string, schema: string): string {
  const u = new URL(url);
  u.searchParams.set("schema", schema);
  return u.toString();
}

async function startPostgres(): Promise<Started> {
  const fromEnv = process.env.TEST_DATABASE_URL;
  if (fromEnv) return { url: fromEnv };
  try {
    const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
    const container = await new PostgreSqlContainer("postgres:16").start();
    return {
      url: container.getConnectionUri(),
      stop: () => container.stop().then(() => undefined),
    };
  } catch (err) {
    throw new Error(
      "Интеграционным тестам нужен Postgres: задайте TEST_DATABASE_URL или запустите Docker " +
        `для Testcontainers. Причина: ${(err as Error).message}`,
    );
  }
}

async function startRedis(): Promise<Started> {
  const fromEnv = process.env.TEST_REDIS_URL;
  if (fromEnv) return { url: fromEnv };
  try {
    const { RedisContainer } = await import("@testcontainers/redis");
    const container = await new RedisContainer("redis:7").start();
    return {
      url: container.getConnectionUrl(),
      stop: () => container.stop().then(() => undefined),
    };
  } catch (err) {
    throw new Error(
      "Интеграционным тестам нужен Redis: задайте TEST_REDIS_URL или запустите Docker " +
        `для Testcontainers. Причина: ${(err as Error).message}`,
    );
  }
}

function migrate(dbUrl: string, dbPackageDir: string): void {
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: dbPackageDir,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: "pipe",
  });
}

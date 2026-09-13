import { execFileSync } from "node:child_process";
import path from "node:path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
  }
}

const DB_PACKAGE_DIR = path.resolve(__dirname, "../../db");

/**
 * Поднимает БД для интеграционных тестов:
 *  - TEST_DATABASE_URL задан → используем его (CI-сервис, локальный Postgres);
 *  - иначе Testcontainers postgres:16 (нужен Docker).
 * Затем применяет миграции `prisma migrate deploy`.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  let dbUrl = process.env.TEST_DATABASE_URL;
  let stop: (() => Promise<void>) | undefined;

  if (!dbUrl) {
    try {
      const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
      const container = await new PostgreSqlContainer("postgres:16").start();
      dbUrl = container.getConnectionUri();
      stop = async () => {
        await container.stop();
      };
    } catch (err) {
      throw new Error(
        "Интеграционным тестам ledger нужен Postgres: задайте TEST_DATABASE_URL " +
          `или запустите Docker для Testcontainers. Причина: ${(err as Error).message}`,
      );
    }
  }

  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: DB_PACKAGE_DIR,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: "pipe",
  });

  project.provide("dbUrl", dbUrl);
  return async () => {
    await stop?.();
  };
}

import { PrismaClient } from "@kadr/db";
import { inject } from "vitest";
import { LedgerService } from "../src";

let client: PrismaClient | undefined;

export function prisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient({ datasources: { db: { url: inject("dbUrl") } } });
  }
  return client;
}

export function ledger(): LedgerService {
  return new LedgerService(prisma());
}

export async function resetDb(): Promise<void> {
  await prisma().$executeRawUnsafe(
    'TRUNCATE "ledger_mismatches", "ledger_entries", "credit_accounts", "users" CASCADE',
  );
}

export async function disconnect(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}

let seq = 0;

/** Создаёт пользователя со счётом и стартовым балансом (напрямую в БД — это тестовая фикстура). */
export async function createUser(balance: bigint = 0n, reserved: bigint = 0n): Promise<string> {
  seq += 1;
  const user = await prisma().user.create({
    data: { telegramId: BigInt(1_000_000 + seq), firstName: `u${seq}`, referralCode: `T${seq}` },
  });
  await prisma().$executeRaw`
    INSERT INTO "credit_accounts" ("user_id", "balance", "reserved", "updated_at")
    VALUES (${user.id}, ${balance}, ${reserved}, now())`;
  return user.id;
}

export async function ledgerSum(userId: string): Promise<bigint> {
  const rows = await prisma().$queryRaw<Array<{ sum: bigint }>>`
    SELECT COALESCE(SUM("delta"), 0)::bigint AS "sum" FROM "ledger_entries" WHERE "user_id" = ${userId}`;
  return BigInt(rows[0]?.sum ?? 0n);
}

export async function entryCount(userId: string): Promise<number> {
  return prisma().ledgerEntry.count({ where: { userId } });
}

export function ref(refId: string, refType = "generation") {
  return { refType, refId };
}

/** Запускает все промисы параллельно и разделяет исходы. */
export async function settle<T>(tasks: Array<Promise<T>>) {
  const results = await Promise.allSettled(tasks);
  const fulfilled: Array<PromiseFulfilledResult<Awaited<T>>> = [];
  const rejected: PromiseRejectedResult[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") fulfilled.push(r);
    else rejected.push(r);
  }
  return { fulfilled, rejected };
}

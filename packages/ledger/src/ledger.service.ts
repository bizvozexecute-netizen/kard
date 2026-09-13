import { Prisma, type LedgerEntry, type LedgerType, type PrismaClient } from "@kadr/db";
import {
  AccountNotFoundError,
  IllegalTransitionError,
  InsufficientCreditsError,
  InsufficientReservedError,
  LedgerArgumentError,
} from "./errors";
import type {
  Balance,
  GrantType,
  ListEntriesParams,
  ListEntriesResult,
  Mismatch,
  Ref,
} from "./types";

type Tx = Prisma.TransactionClient;

interface AccountRow {
  balance: bigint;
  reserved: bigint;
}

const PRISMA_UNIQUE_VIOLATION = "P2002";

/**
 * Единственная точка изменения credit_accounts (правило 1 CLAUDE.md).
 *
 * Все мутации — одна interactive-транзакция с атомарным UPDATE … WHERE <условие> RETURNING,
 * поэтому гонки решаются блокировкой строки, без SERIALIZABLE.
 *
 * Инвариант журнала: SUM(delta) по пользователю == balance + reserved.
 * reserve запись не создаёт (перенос balance → reserved), release пишет delta = 0 как след.
 */
export class LedgerService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Создаёт пустой счёт, если его ещё нет. Идемпотентно. */
  async ensureAccount(userId: string): Promise<void> {
    assertNonEmpty(userId, "userId");
    await this.prisma.$executeRaw`
      INSERT INTO "credit_accounts" ("user_id", "balance", "reserved", "updated_at")
      VALUES (${userId}, 0, 0, now())
      ON CONFLICT ("user_id") DO NOTHING`;
  }

  async getBalance(userId: string): Promise<Balance> {
    assertNonEmpty(userId, "userId");
    const row = await this.readAccount(this.prisma, userId);
    if (!row) throw new AccountNotFoundError(userId);
    return { balance: row.balance, reserved: row.reserved };
  }

  /**
   * Резерв под операцию: balance -= a, reserved += a. Без записи в журнал.
   * 0 обновлённых строк → нет счёта или не хватает кредитов (точное missing).
   */
  async reserve(userId: string, amount: bigint, ref: Ref): Promise<Balance> {
    assertNonEmpty(userId, "userId");
    assertAmount(amount);
    assertRef(ref);

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<AccountRow[]>`
        UPDATE "credit_accounts"
        SET "balance" = "balance" - ${amount}, "reserved" = "reserved" + ${amount}, "updated_at" = now()
        WHERE "user_id" = ${userId} AND "balance" >= ${amount}
        RETURNING "balance", "reserved"`;
      const updated = rows[0];
      if (updated) return { balance: updated.balance, reserved: updated.reserved };

      const current = await this.readAccount(tx, userId);
      if (!current) throw new AccountNotFoundError(userId);
      throw new InsufficientCreditsError(amount - current.balance);
    });
  }

  /**
   * Фиксация траты после успешной операции: reserved -= a + запись SPEND(delta = -a).
   * Идемпотентно по idemKey: повтор возвращает существующую запись.
   */
  async commit(userId: string, amount: bigint, ref: Ref, idemKey: string): Promise<LedgerEntry> {
    assertNonEmpty(userId, "userId");
    assertAmount(amount);
    assertRef(ref);
    assertNonEmpty(idemKey, "idemKey");

    return this.idempotent(idemKey, (tx) => async () => {
      await this.assertNoEntry(tx, ref, "REFUND", "commit after release");

      const rows = await tx.$queryRaw<AccountRow[]>`
        UPDATE "credit_accounts"
        SET "reserved" = "reserved" - ${amount}, "updated_at" = now()
        WHERE "user_id" = ${userId} AND "reserved" >= ${amount}
        RETURNING "balance", "reserved"`;
      const updated = rows[0];
      if (!updated) {
        // строка уже под нашей блокировкой не была — читаем актуальное состояние
        const existing = await this.findByKey(tx, idemKey);
        if (existing) return existing;
        const current = await this.readAccount(tx, userId);
        if (!current) throw new AccountNotFoundError(userId);
        throw new InsufficientReservedError(current.reserved, amount);
      }

      return tx.ledgerEntry.create({
        data: {
          userId,
          delta: -amount,
          type: "SPEND",
          refType: ref.refType,
          refId: ref.refId,
          balanceAfter: updated.balance,
          idempotencyKey: idemKey,
        },
      });
    });
  }

  /**
   * Возврат резерва при неудаче: balance += a, reserved -= a + запись REFUND(delta = 0, comment 'release').
   * Идемпотентно. После commit по той же ссылке — IllegalTransitionError.
   */
  async release(userId: string, amount: bigint, ref: Ref, idemKey: string): Promise<LedgerEntry> {
    assertNonEmpty(userId, "userId");
    assertAmount(amount);
    assertRef(ref);
    assertNonEmpty(idemKey, "idemKey");

    return this.idempotent(idemKey, (tx) => async () => {
      await this.assertNoEntry(tx, ref, "SPEND", "release after commit");

      const rows = await tx.$queryRaw<AccountRow[]>`
        UPDATE "credit_accounts"
        SET "balance" = "balance" + ${amount}, "reserved" = "reserved" - ${amount}, "updated_at" = now()
        WHERE "user_id" = ${userId} AND "reserved" >= ${amount}
        RETURNING "balance", "reserved"`;
      const updated = rows[0];
      if (!updated) {
        const existing = await this.findByKey(tx, idemKey);
        if (existing) return existing;
        const current = await this.readAccount(tx, userId);
        if (!current) throw new AccountNotFoundError(userId);
        throw new InsufficientReservedError(current.reserved, amount);
      }

      return tx.ledgerEntry.create({
        data: {
          userId,
          delta: 0n,
          type: "REFUND",
          refType: ref.refType,
          refId: ref.refId,
          balanceAfter: updated.balance,
          idempotencyKey: idemKey,
          comment: "release",
        },
      });
    });
  }

  /** Начисление: balance += a + запись type(delta = +a). Идемпотентно. */
  async grant(
    userId: string,
    amount: bigint,
    type: GrantType,
    ref: Ref,
    idemKey: string,
    comment?: string,
  ): Promise<LedgerEntry> {
    assertNonEmpty(userId, "userId");
    assertAmount(amount);
    assertRef(ref);
    assertNonEmpty(idemKey, "idemKey");

    return this.idempotent(idemKey, (tx) => async () => {
      const rows = await tx.$queryRaw<AccountRow[]>`
        UPDATE "credit_accounts"
        SET "balance" = "balance" + ${amount}, "updated_at" = now()
        WHERE "user_id" = ${userId}
        RETURNING "balance", "reserved"`;
      const updated = rows[0];
      if (!updated) {
        const existing = await this.findByKey(tx, idemKey);
        if (existing) return existing;
        throw new AccountNotFoundError(userId);
      }

      return tx.ledgerEntry.create({
        data: {
          userId,
          delta: amount,
          type,
          refType: ref.refType,
          refId: ref.refId,
          balanceAfter: updated.balance,
          idempotencyKey: idemKey,
          comment: comment ?? null,
        },
      });
    });
  }

  /** Мгновенное списание без резерва (reserve + commit одним шагом). Идемпотентно. */
  async spendDirect(
    userId: string,
    amount: bigint,
    ref: Ref,
    idemKey: string,
    comment?: string,
  ): Promise<LedgerEntry> {
    assertNonEmpty(userId, "userId");
    assertAmount(amount);
    assertRef(ref);
    assertNonEmpty(idemKey, "idemKey");

    return this.idempotent(idemKey, (tx) => async () => {
      const rows = await tx.$queryRaw<AccountRow[]>`
        UPDATE "credit_accounts"
        SET "balance" = "balance" - ${amount}, "updated_at" = now()
        WHERE "user_id" = ${userId} AND "balance" >= ${amount}
        RETURNING "balance", "reserved"`;
      const updated = rows[0];
      if (!updated) {
        const existing = await this.findByKey(tx, idemKey);
        if (existing) return existing;
        const current = await this.readAccount(tx, userId);
        if (!current) throw new AccountNotFoundError(userId);
        throw new InsufficientCreditsError(amount - current.balance);
      }

      return tx.ledgerEntry.create({
        data: {
          userId,
          delta: -amount,
          type: "SPEND",
          refType: ref.refType,
          refId: ref.refId,
          balanceAfter: updated.balance,
          idempotencyKey: idemKey,
          comment: comment ?? null,
        },
      });
    });
  }

  /** Журнал пользователя, новые сверху, keyset-курсор (createdAt, id). */
  async listEntries(userId: string, params: ListEntriesParams): Promise<ListEntriesResult> {
    assertNonEmpty(userId, "userId");
    const limit = Math.max(1, Math.min(100, Math.trunc(params.limit)));
    const after = params.cursor ? decodeCursor(params.cursor) : null;

    const items = await this.prisma.ledgerEntry.findMany({
      where: after
        ? {
            userId,
            OR: [
              { createdAt: { lt: after.createdAt } },
              { createdAt: after.createdAt, id: { lt: after.id } },
            ],
          }
        : { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const last = page[page.length - 1];
    return { items: page, nextCursor: hasMore && last ? encodeCursor(last) : null };
  }

  /**
   * Сверка: для каждого счёта, где были движения с `since`,
   * SUM(delta) по журналу должен равняться balance + reserved.
   * Расхождения записываются в ledger_mismatches и возвращаются.
   */
  async reconcileActiveSince(since: Date): Promise<Mismatch[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ user_id: string; balance: bigint; reserved: bigint; expected: bigint }>
    >`
      SELECT a."user_id", a."balance", a."reserved", COALESCE(SUM(e."delta"), 0)::bigint AS "expected"
      FROM "credit_accounts" a
      LEFT JOIN "ledger_entries" e ON e."user_id" = a."user_id"
      WHERE a."user_id" IN (
        SELECT "user_id" FROM "ledger_entries" WHERE "created_at" >= ${since}
        UNION
        SELECT "user_id" FROM "credit_accounts" WHERE "updated_at" >= ${since}
      )
      GROUP BY a."user_id", a."balance", a."reserved"
      HAVING COALESCE(SUM(e."delta"), 0) <> a."balance" + a."reserved"`;

    const mismatches: Mismatch[] = rows.map((r) => ({
      userId: r.user_id,
      expected: BigInt(r.expected),
      balance: BigInt(r.balance),
      reserved: BigInt(r.reserved),
    }));

    if (mismatches.length > 0) {
      await this.prisma.ledgerMismatch.createMany({
        data: mismatches.map((m) => ({
          userId: m.userId,
          expected: m.expected,
          balance: m.balance,
          reserved: m.reserved,
        })),
      });
    }
    return mismatches;
  }

  // ---------------------------------------------------------------------------

  /**
   * Идемпотентная мутация: быстрый путь по ключу, транзакция,
   * при гонке за один ключ (unique violation) — откат и возврат уже записанной строки.
   */
  private async idempotent(
    idemKey: string,
    body: (tx: Tx) => () => Promise<LedgerEntry>,
  ): Promise<LedgerEntry> {
    const existing = await this.findByKey(this.prisma, idemKey);
    if (existing) return existing;

    try {
      return await this.prisma.$transaction((tx) => body(tx)());
    } catch (err) {
      if (isUniqueViolation(err)) {
        const winner = await this.findByKey(this.prisma, idemKey);
        if (winner) return winner;
      }
      throw err;
    }
  }

  private findByKey(db: Tx | PrismaClient, idemKey: string): Promise<LedgerEntry | null> {
    return db.ledgerEntry.findUnique({ where: { idempotencyKey: idemKey } });
  }

  private async readAccount(db: Tx | PrismaClient, userId: string): Promise<AccountRow | null> {
    const rows = await db.$queryRaw<AccountRow[]>`
      SELECT "balance", "reserved" FROM "credit_accounts" WHERE "user_id" = ${userId}`;
    return rows[0] ?? null;
  }

  /** Запрещает переход, если по ссылке уже есть запись противоположного типа. */
  private async assertNoEntry(tx: Tx, ref: Ref, type: LedgerType, reason: string): Promise<void> {
    const clash = await tx.ledgerEntry.findFirst({
      where: { refType: ref.refType, refId: ref.refId, type },
      select: { id: true },
    });
    if (clash) throw new IllegalTransitionError({ ...ref, reason });
  }
}

// ---------------------------------------------------------------------------

function assertAmount(amount: bigint): void {
  if (typeof amount !== "bigint") throw new LedgerArgumentError("amount must be a bigint");
  if (amount <= 0n) throw new LedgerArgumentError("amount must be positive");
}

function assertNonEmpty(value: string, name: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new LedgerArgumentError(`${name} must be a non-empty string`);
  }
}

function assertRef(ref: Ref): void {
  assertNonEmpty(ref.refType, "refType");
  assertNonEmpty(ref.refId, "refId");
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === PRISMA_UNIQUE_VIOLATION
  );
}

function encodeCursor(entry: Pick<LedgerEntry, "createdAt" | "id">): string {
  return Buffer.from(`${entry.createdAt.toISOString()}|${entry.id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const sep = raw.indexOf("|");
  const createdAt = new Date(sep > 0 ? raw.slice(0, sep) : "");
  const id = sep > 0 ? raw.slice(sep + 1) : "";
  if (Number.isNaN(createdAt.getTime()) || id.length === 0) {
    throw new LedgerArgumentError("invalid cursor");
  }
  return { createdAt, id };
}

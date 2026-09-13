import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  AccountNotFoundError,
  IllegalTransitionError,
  InsufficientCreditsError,
  InsufficientReservedError,
  LedgerArgumentError,
} from "../src";
import {
  createUser,
  disconnect,
  entryCount,
  ledger,
  ledgerSum,
  prisma,
  ref,
  resetDb,
  settle,
} from "./helpers";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await disconnect();
});

describe("reserve", () => {
  it("при достаточном балансе переносит сумму в reserved и не пишет в журнал", async () => {
    const userId = await createUser(100n);
    const result = await ledger().reserve(userId, 30n, ref("g1"));
    expect(result).toEqual({ balance: 70n, reserved: 30n });
    expect(await entryCount(userId)).toBe(0);
    expect(await ledger().getBalance(userId)).toEqual({ balance: 70n, reserved: 30n });
  });

  it("при нехватке бросает InsufficientCreditsError с точным missing и ничего не меняет", async () => {
    const userId = await createUser(25n);
    const err = await ledger()
      .reserve(userId, 40n, ref("g1"))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InsufficientCreditsError);
    expect((err as InsufficientCreditsError).missing).toBe(15n);
    expect((err as InsufficientCreditsError).details).toEqual({ missing: "15" });
    expect(await ledger().getBalance(userId)).toEqual({ balance: 25n, reserved: 0n });
  });

  it("для несуществующего счёта — AccountNotFoundError", async () => {
    await expect(ledger().reserve("nope", 1n, ref("g1"))).rejects.toBeInstanceOf(
      AccountNotFoundError,
    );
  });

  it("20 параллельных reserve(10) при балансе 100 → ровно 10 успешных", async () => {
    const userId = await createUser(100n);
    const { fulfilled, rejected } = await settle(
      Array.from({ length: 20 }, (_, i) => ledger().reserve(userId, 10n, ref(`g${i}`))),
    );
    expect(fulfilled).toHaveLength(10);
    expect(rejected).toHaveLength(10);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(InsufficientCreditsError);
    expect(await ledger().getBalance(userId)).toEqual({ balance: 0n, reserved: 100n });
  });
});

describe("commit", () => {
  it("списывает резерв и пишет SPEND с balanceAfter", async () => {
    const userId = await createUser(100n);
    await ledger().reserve(userId, 30n, ref("g1"));
    const entry = await ledger().commit(userId, 30n, ref("g1"), "commit:g1");
    expect(entry).toMatchObject({
      userId,
      delta: -30n,
      type: "SPEND",
      refType: "generation",
      refId: "g1",
      balanceAfter: 70n,
      idempotencyKey: "commit:g1",
    });
    expect(await ledger().getBalance(userId)).toEqual({ balance: 70n, reserved: 0n });
  });

  it("идемпотентен: двойной вызов — одна запись, баланс не меняется", async () => {
    const userId = await createUser(100n);
    await ledger().reserve(userId, 30n, ref("g1"));
    const first = await ledger().commit(userId, 30n, ref("g1"), "commit:g1");
    const second = await ledger().commit(userId, 30n, ref("g1"), "commit:g1");
    expect(second.id).toBe(first.id);
    expect(await entryCount(userId)).toBe(1);
    expect(await ledger().getBalance(userId)).toEqual({ balance: 70n, reserved: 0n });
  });

  it("идемпотентен при параллельном двойном вызове", async () => {
    const userId = await createUser(100n);
    await ledger().reserve(userId, 30n, ref("g1"));
    const { fulfilled, rejected } = await settle([
      ledger().commit(userId, 30n, ref("g1"), "commit:g1"),
      ledger().commit(userId, 30n, ref("g1"), "commit:g1"),
      ledger().commit(userId, 30n, ref("g1"), "commit:g1"),
    ]);
    expect(rejected).toHaveLength(0);
    const ids = new Set(fulfilled.map((f) => f.value.id));
    expect(ids.size).toBe(1);
    expect(await entryCount(userId)).toBe(1);
    expect(await ledger().getBalance(userId)).toEqual({ balance: 70n, reserved: 0n });
  });

  it("больше зарезервированного — InsufficientReservedError, состояние не меняется", async () => {
    const userId = await createUser(100n);
    await ledger().reserve(userId, 30n, ref("g1"));
    const err = await ledger()
      .commit(userId, 31n, ref("g1"), "commit:g1")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InsufficientReservedError);
    expect((err as InsufficientReservedError).details).toMatchObject({
      reserved: "30",
      requested: "31",
    });
    expect(await entryCount(userId)).toBe(0);
    expect(await ledger().getBalance(userId)).toEqual({ balance: 70n, reserved: 30n });
  });

  it("commit после release по той же ссылке — IllegalTransitionError", async () => {
    const userId = await createUser(100n);
    await ledger().reserve(userId, 30n, ref("g1"));
    await ledger().release(userId, 30n, ref("g1"), "release:g1");
    await expect(ledger().commit(userId, 30n, ref("g1"), "commit:g1")).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
  });

  it("без счёта — AccountNotFoundError", async () => {
    await expect(ledger().commit("nope", 1n, ref("g1"), "k")).rejects.toBeInstanceOf(
      AccountNotFoundError,
    );
  });
});

describe("release", () => {
  it("возвращает резерв в баланс и пишет REFUND с delta=0 и comment='release'", async () => {
    const userId = await createUser(100n);
    await ledger().reserve(userId, 30n, ref("g1"));
    const entry = await ledger().release(userId, 30n, ref("g1"), "release:g1");
    expect(entry).toMatchObject({
      delta: 0n,
      type: "REFUND",
      comment: "release",
      balanceAfter: 100n,
      idempotencyKey: "release:g1",
    });
    expect(await ledger().getBalance(userId)).toEqual({ balance: 100n, reserved: 0n });
  });

  it("идемпотентен, в том числе параллельно", async () => {
    const userId = await createUser(100n);
    await ledger().reserve(userId, 30n, ref("g1"));
    const { fulfilled, rejected } = await settle([
      ledger().release(userId, 30n, ref("g1"), "release:g1"),
      ledger().release(userId, 30n, ref("g1"), "release:g1"),
    ]);
    expect(rejected).toHaveLength(0);
    expect(new Set(fulfilled.map((f) => f.value.id)).size).toBe(1);
    const again = await ledger().release(userId, 30n, ref("g1"), "release:g1");
    expect(again.id).toBe(fulfilled[0]!.value.id);
    expect(await entryCount(userId)).toBe(1);
    expect(await ledger().getBalance(userId)).toEqual({ balance: 100n, reserved: 0n });
  });

  it("release после commit — IllegalTransitionError, даже если reserved хватает", async () => {
    const userId = await createUser(100n);
    await ledger().reserve(userId, 30n, ref("g1"));
    await ledger().reserve(userId, 30n, ref("g2")); // другой резерв, reserved = 60
    await ledger().commit(userId, 30n, ref("g1"), "commit:g1");
    const err = await ledger()
      .release(userId, 30n, ref("g1"), "release:g1")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IllegalTransitionError);
    expect((err as IllegalTransitionError).details).toMatchObject({
      refId: "g1",
      reason: "release after commit",
    });
    // резерв g2 не тронут
    expect(await ledger().getBalance(userId)).toEqual({ balance: 40n, reserved: 30n });
  });

  it("больше зарезервированного — InsufficientReservedError", async () => {
    const userId = await createUser(100n);
    await ledger().reserve(userId, 10n, ref("g1"));
    await expect(ledger().release(userId, 11n, ref("g1"), "release:g1")).rejects.toBeInstanceOf(
      InsufficientReservedError,
    );
  });

  it("без счёта — AccountNotFoundError", async () => {
    await expect(ledger().release("nope", 1n, ref("g1"), "k")).rejects.toBeInstanceOf(
      AccountNotFoundError,
    );
  });
});

describe("grant", () => {
  it("начисляет и пишет запись нужного типа с комментарием", async () => {
    const userId = await createUser(0n);
    const entry = await ledger().grant(
      userId,
      50n,
      "BONUS",
      ref(userId, "signup"),
      "signup:u",
      "welcome",
    );
    expect(entry).toMatchObject({
      delta: 50n,
      type: "BONUS",
      balanceAfter: 50n,
      comment: "welcome",
    });
    expect(await ledger().getBalance(userId)).toEqual({ balance: 50n, reserved: 0n });
  });

  it("идемпотентен по ключу, в том числе параллельно", async () => {
    const userId = await createUser(0n);
    const { fulfilled, rejected } = await settle(
      Array.from({ length: 5 }, () =>
        ledger().grant(userId, 50n, "DAILY", ref("2026-01-01", "daily"), "daily:u:2026-01-01"),
      ),
    );
    expect(rejected).toHaveLength(0);
    expect(new Set(fulfilled.map((f) => f.value.id)).size).toBe(1);
    await ledger().grant(userId, 50n, "DAILY", ref("2026-01-01", "daily"), "daily:u:2026-01-01");
    expect(await entryCount(userId)).toBe(1);
    expect(await ledger().getBalance(userId)).toEqual({ balance: 50n, reserved: 0n });
  });

  it("без счёта — AccountNotFoundError", async () => {
    await expect(
      ledger().grant("nope", 1n, "MANUAL", ref("x", "manual"), "k"),
    ).rejects.toBeInstanceOf(AccountNotFoundError);
  });
});

describe("spendDirect", () => {
  it("списывает сразу и пишет SPEND", async () => {
    const userId = await createUser(20n);
    const entry = await ledger().spendDirect(userId, 5n, ref("u1", "upscale"), "spend:u1", "x4");
    expect(entry).toMatchObject({ delta: -5n, type: "SPEND", balanceAfter: 15n, comment: "x4" });
    expect(await ledger().getBalance(userId)).toEqual({ balance: 15n, reserved: 0n });
  });

  it("идемпотентен и не списывает дважды", async () => {
    const userId = await createUser(20n);
    await ledger().spendDirect(userId, 5n, ref("u1", "upscale"), "spend:u1");
    await ledger().spendDirect(userId, 5n, ref("u1", "upscale"), "spend:u1");
    expect(await entryCount(userId)).toBe(1);
    expect(await ledger().getBalance(userId)).toEqual({ balance: 15n, reserved: 0n });
  });

  it("при нехватке — InsufficientCreditsError с missing; без счёта — AccountNotFoundError", async () => {
    const userId = await createUser(3n);
    const err = await ledger()
      .spendDirect(userId, 5n, ref("u1", "upscale"), "spend:u1")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InsufficientCreditsError);
    expect((err as InsufficientCreditsError).missing).toBe(2n);
    await expect(
      ledger().spendDirect("nope", 5n, ref("u1", "upscale"), "spend:x"),
    ).rejects.toBeInstanceOf(AccountNotFoundError);
  });
});

describe("аргументы", () => {
  it("сумма ≤ 0, не bigint, пустые ключи — LedgerArgumentError до обращения к БД", async () => {
    const svc = ledger();
    await expect(svc.reserve("u", 0n, ref("g"))).rejects.toBeInstanceOf(LedgerArgumentError);
    await expect(svc.reserve("u", -1n, ref("g"))).rejects.toBeInstanceOf(LedgerArgumentError);
    await expect(svc.reserve("u", 5 as unknown as bigint, ref("g"))).rejects.toBeInstanceOf(
      LedgerArgumentError,
    );
    await expect(svc.reserve("", 1n, ref("g"))).rejects.toBeInstanceOf(LedgerArgumentError);
    await expect(svc.reserve("u", 1n, { refType: "", refId: "g" })).rejects.toBeInstanceOf(
      LedgerArgumentError,
    );
    await expect(svc.commit("u", 1n, ref("g"), "")).rejects.toBeInstanceOf(LedgerArgumentError);
    await expect(svc.getBalance("")).rejects.toBeInstanceOf(LedgerArgumentError);
    await expect(svc.listEntries("", { limit: 10 })).rejects.toBeInstanceOf(LedgerArgumentError);
    await expect(svc.ensureAccount("")).rejects.toBeInstanceOf(LedgerArgumentError);
  });

  it("невалидный курсор — LedgerArgumentError", async () => {
    const userId = await createUser(0n);
    await expect(ledger().listEntries(userId, { limit: 10, cursor: "!!!" })).rejects.toBeInstanceOf(
      LedgerArgumentError,
    );
    const noSep = Buffer.from("2026-01-01T00:00:00.000Z", "utf8").toString("base64url");
    await expect(ledger().listEntries(userId, { limit: 10, cursor: noSep })).rejects.toBeInstanceOf(
      LedgerArgumentError,
    );
  });
});

describe("ensureAccount / getBalance", () => {
  it("создаёт пустой счёт один раз", async () => {
    const user = await prisma().user.create({ data: { telegramId: 42n } });
    await expect(ledger().getBalance(user.id)).rejects.toBeInstanceOf(AccountNotFoundError);
    await ledger().ensureAccount(user.id);
    await ledger().ensureAccount(user.id);
    expect(await ledger().getBalance(user.id)).toEqual({ balance: 0n, reserved: 0n });
  });
});

describe("listEntries", () => {
  it("отдаёт новые сверху, курсор ведёт дальше, в конце nextCursor = null", async () => {
    const userId = await createUser(1000n);
    for (let i = 0; i < 7; i++) {
      await ledger().spendDirect(userId, 1n, ref(`s${i}`), `spend:${i}`);
    }
    const page1 = await ledger().listEntries(userId, { limit: 3 });
    expect(page1.items.map((e) => e.refId)).toEqual(["s6", "s5", "s4"]);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await ledger().listEntries(userId, { limit: 3, cursor: page1.nextCursor! });
    expect(page2.items.map((e) => e.refId)).toEqual(["s3", "s2", "s1"]);

    const page3 = await ledger().listEntries(userId, { limit: 3, cursor: page2.nextCursor! });
    expect(page3.items.map((e) => e.refId)).toEqual(["s0"]);
    expect(page3.nextCursor).toBeNull();
  });

  it("ограничивает limit диапазоном 1..100", async () => {
    const userId = await createUser(10n);
    await ledger().spendDirect(userId, 1n, ref("a"), "a");
    await ledger().spendDirect(userId, 1n, ref("b"), "b");
    expect((await ledger().listEntries(userId, { limit: 0 })).items).toHaveLength(1);
    expect((await ledger().listEntries(userId, { limit: 999 })).items).toHaveLength(2);
  });
});

describe("CHECK-констрейнты", () => {
  it("прямой SQL не может увести balance или reserved в минус", async () => {
    const userId = await createUser(5n);
    await expect(
      prisma().$executeRaw`UPDATE "credit_accounts" SET "balance" = -1 WHERE "user_id" = ${userId}`,
    ).rejects.toMatchObject({ meta: expect.objectContaining({ code: "23514" }) });
    await expect(
      prisma()
        .$executeRaw`UPDATE "credit_accounts" SET "reserved" = -1 WHERE "user_id" = ${userId}`,
    ).rejects.toMatchObject({ meta: expect.objectContaining({ code: "23514" }) });
    expect(await ledger().getBalance(userId)).toEqual({ balance: 5n, reserved: 0n });
  });
});

describe("reconcileActiveSince", () => {
  it("не находит расхождений у здоровых счетов", async () => {
    const userId = await createUser(0n);
    await ledger().grant(userId, 100n, "BONUS", ref("s", "signup"), "signup");
    await ledger().reserve(userId, 40n, ref("g1"));
    await ledger().reserve(userId, 10n, ref("g2"));
    await ledger().commit(userId, 40n, ref("g1"), "commit:g1");
    await ledger().release(userId, 10n, ref("g2"), "release:g2");
    expect(await ledger().reconcileActiveSince(new Date(Date.now() - 3_600_000))).toEqual([]);
    expect(await prisma().ledgerMismatch.count()).toBe(0);
  });

  it("находит внесённое напрямую расхождение и пишет его в ledger_mismatches", async () => {
    const userId = await createUser(0n);
    await ledger().grant(userId, 100n, "BONUS", ref("s", "signup"), "signup");
    await prisma()
      .$executeRaw`UPDATE "credit_accounts" SET "balance" = 90 WHERE "user_id" = ${userId}`;

    const mismatches = await ledger().reconcileActiveSince(new Date(Date.now() - 3_600_000));
    expect(mismatches).toEqual([{ userId, expected: 100n, balance: 90n, reserved: 0n }]);
    const stored = await prisma().ledgerMismatch.findMany({ where: { userId } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ expected: 100n, balance: 90n, reserved: 0n });
  });

  it("не трогает счета без активности в окне", async () => {
    const userId = await createUser(0n);
    await ledger().grant(userId, 100n, "BONUS", ref("s", "signup"), "signup");
    await prisma()
      .$executeRaw`UPDATE "credit_accounts" SET "balance" = 90 WHERE "user_id" = ${userId}`;
    // окно начинается в будущем — активности нет
    expect(await ledger().reconcileActiveSince(new Date(Date.now() + 60_000))).toEqual([]);
  });
});

describe("инвариант", () => {
  it("SUM(delta) == balance + reserved после смешанной последовательности", async () => {
    const userId = await createUser(0n);
    const svc = ledger();
    await svc.grant(userId, 100n, "PURCHASE", ref("p1", "payment"), "pay:p1");
    await svc.reserve(userId, 30n, ref("g1"));
    await svc.reserve(userId, 20n, ref("g2"));
    await svc.commit(userId, 30n, ref("g1"), "commit:g1");
    await svc.release(userId, 20n, ref("g2"), "release:g2");
    await svc.spendDirect(userId, 5n, ref("u1", "upscale"), "spend:u1");
    await svc.reserve(userId, 15n, ref("g3"));
    const { balance, reserved } = await svc.getBalance(userId);
    expect(balance + reserved).toBe(await ledgerSum(userId));
    expect({ balance, reserved }).toEqual({ balance: 50n, reserved: 15n });
  });
});

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@kadr/db";
import { LedgerService } from "@kadr/ledger";
import type { GenEvent } from "@kadr/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import type { NotifyPayload, PipelineDeps, RouterLike } from "../src/generations/pipeline";
import { runGenerationPipeline } from "../src/generations/pipeline";

let prisma: PrismaClient;
let ledger: LedgerService;

beforeAll(() => {
  prisma = new PrismaClient({ datasources: { db: { url: inject("dbUrl") } } });
  ledger = new LedgerService(prisma);
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "generations", "uploads", "ledger_mismatches", "ledger_entries", "credit_accounts", "users", "daily_claims", "streaks" CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

class FakeStorage {
  files = new Map<string, { mime: string; size: number }>();
  async put(key: string, body: Buffer, mime: string): Promise<void> {
    this.files.set(key, { mime, size: body.length });
  }
  async getSignedUrl(key: string): Promise<string> {
    return `https://signed.local/${key}`;
  }
}

interface Harness {
  deps: PipelineDeps;
  storage: FakeStorage;
  events: GenEvent[];
  notifications: NotifyPayload[];
  router: RouterLike & {
    submit: ReturnType<typeof vi.fn>;
    poll: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
}

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };

function makeHarness(overrides: Partial<PipelineDeps> = {}): Harness {
  const storage = new FakeStorage();
  const events: GenEvent[] = [];
  const notifications: NotifyPayload[] = [];
  const router = {
    submit: vi.fn().mockResolvedValue({
      provider: "fal",
      model: "m1",
      jobId: "m1::req",
      attemptedLinks: 1,
    }),
    poll: vi.fn().mockResolvedValue({
      status: "succeeded",
      outputs: [{ url: "https://cdn.fake/out.png", mime: "image/png" }],
      costUsd: 0.004,
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
  };

  const fetchImpl = vi
    .fn()
    .mockImplementation(
      async () => new Response(Buffer.from("fake-image-bytes"), { status: 200 }),
    ) as unknown as typeof fetch;

  const deps: PipelineDeps = {
    prisma,
    ledger,
    router,
    enhancer: {
      enhance: vi
        .fn()
        .mockResolvedValue({ promptEn: "enhanced prompt", negativeEn: "blur", category: "other" }),
    },
    moderation: { check: vi.fn().mockResolvedValue({ ok: true }) },
    storage,
    publish: async (event) => {
      events.push(event);
    },
    notify: async (job) => {
      notifications.push(job);
    },
    logger: noopLogger,
    pollOverrides: { intervalMs: 5, deadlineMs: 5_000 },
    sleep: async () => undefined,
    fetchImpl,
    ...overrides,
  };
  return { deps, storage, events, notifications, router };
}

async function createUserWithBalance(balance: bigint): Promise<string> {
  const user = await prisma.user.create({
    data: {
      telegramId: BigInt(Math.floor(Math.random() * 1e9)),
      referralCode: randomUUID().slice(0, 8),
    },
  });
  await prisma.$executeRaw`
    INSERT INTO "credit_accounts" ("user_id", "balance", "reserved", "updated_at")
    VALUES (${user.id}, ${balance}, 0, now())`;
  return user.id;
}

/** Создаёт генерацию как это делает api: строка QUEUED + резерв. */
async function createGeneration(
  userId: string,
  opts: { cost?: number; kind?: "IMAGE" | "VIDEO"; enhance?: boolean; operationKey?: string } = {},
): Promise<string> {
  const cost = opts.cost ?? 5;
  const gen = await prisma.generation.create({
    data: {
      userId,
      operationKey: opts.operationKey ?? "image_draft",
      kind: opts.kind ?? "IMAGE",
      promptRaw: "рыжий кот",
      params: { enhance: opts.enhance ?? true },
      variants: 1,
      costCredits: cost,
      idempotencyKey: `${userId}:${randomUUID()}`,
    },
  });
  await ledger.reserve(userId, BigInt(cost), { refType: "generation", refId: gen.id });
  return gen.id;
}

const balances = async (userId: string) => ledger.getBalance(userId);

// ---------------------------------------------------------------------------

describe("runGenerationPipeline", () => {
  it("успех: статусы по порядку, файл в storage, commit ровно cost, notify gen_ready", async () => {
    const userId = await createUserWithBalance(100n);
    const id = await createGeneration(userId);
    const h = makeHarness();

    await runGenerationPipeline(h.deps, id);

    const gen = await prisma.generation.findUniqueOrThrow({ where: { id } });
    expect(gen.status).toBe("SUCCEEDED");
    expect(gen.promptFinal).toBe("enhanced prompt");
    expect(gen.negativePrompt).toBe("blur");
    expect(gen.resultKeys).toEqual([`results/${userId}/${id}/0.png`]);
    expect(Number(gen.costUsdActual)).toBeCloseTo(0.004);
    expect(gen.finishedAt).not.toBeNull();

    expect(h.storage.files.has(`results/${userId}/${id}/0.png`)).toBe(true);
    expect(await balances(userId)).toEqual({ balance: 95n, reserved: 0n });
    const spend = await prisma.ledgerEntry.findMany({ where: { idempotencyKey: `commit:${id}` } });
    expect(spend).toHaveLength(1);
    expect(spend[0]).toMatchObject({ delta: -5n, type: "SPEND" });

    expect(h.events.map((e) => e.status)).toEqual([
      "MODERATING",
      "ENHANCING",
      "RUNNING",
      "SUCCEEDED",
    ]);
    expect(h.events.at(-1)?.resultUrls).toEqual([
      `https://signed.local/results/${userId}/${id}/0.png`,
    ]);
    expect(h.notifications).toEqual([{ type: "gen_ready", userId, payload: { generationId: id } }]);
  });

  it("провал провайдера → FAILED + полный release, notify gen_failed", async () => {
    const userId = await createUserWithBalance(100n);
    const id = await createGeneration(userId, { cost: 79 });
    const h = makeHarness();
    h.router.poll.mockResolvedValue({ status: "failed", errorCode: "PROVIDER_ERROR" });

    await runGenerationPipeline(h.deps, id);

    const gen = await prisma.generation.findUniqueOrThrow({ where: { id } });
    expect(gen).toMatchObject({ status: "FAILED", errorCode: "PROVIDER_ERROR" });
    expect(await balances(userId)).toEqual({ balance: 100n, reserved: 0n });
    expect(h.notifications[0]).toMatchObject({ type: "gen_failed" });
    // release-запись с delta 0 существует
    expect(await prisma.ledgerEntry.count({ where: { idempotencyKey: `release:${id}` } })).toBe(1);
  });

  it("модерация блокирует → FAILED MODERATION_BLOCKED, провайдер не вызывался", async () => {
    const userId = await createUserWithBalance(50n);
    const id = await createGeneration(userId);
    const h = makeHarness();
    (h.deps.moderation.check as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      reason: "bad",
    });

    await runGenerationPipeline(h.deps, id);

    const gen = await prisma.generation.findUniqueOrThrow({ where: { id } });
    expect(gen).toMatchObject({ status: "FAILED", errorCode: "MODERATION_BLOCKED" });
    expect(h.router.submit).not.toHaveBeenCalled();
    expect(await balances(userId)).toEqual({ balance: 50n, reserved: 0n });
  });

  it("enhancer вернул null → генерация идёт с исходным промптом", async () => {
    const userId = await createUserWithBalance(50n);
    const id = await createGeneration(userId);
    const h = makeHarness();
    (h.deps.enhancer.enhance as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await runGenerationPipeline(h.deps, id);

    const gen = await prisma.generation.findUniqueOrThrow({ where: { id } });
    expect(gen.status).toBe("SUCCEEDED");
    expect(gen.promptFinal).toBe("рыжий кот");
    expect(h.router.submit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ prompt: "рыжий кот" }),
    );
  });

  it("enhance=false → enhancer не вызывается", async () => {
    const userId = await createUserWithBalance(50n);
    const id = await createGeneration(userId, { enhance: false });
    const h = makeHarness();
    await runGenerationPipeline(h.deps, id);
    expect(h.deps.enhancer.enhance).not.toHaveBeenCalled();
  });

  it("рестарт воркера между submit и poll: пересабмита нет, commit один", async () => {
    const userId = await createUserWithBalance(50n);
    const id = await createGeneration(userId);

    // Состояние «воркер умер сразу после submit»: RUNNING + providerJobId, резерв держится.
    // (Настоящий краш убивает процесс до catch — статус в БД остаётся RUNNING.)
    await prisma.generation.update({
      where: { id },
      data: {
        status: "RUNNING",
        provider: "fal",
        model: "m1",
        providerJobId: "m1::req",
        promptFinal: "enhanced prompt",
        startedAt: new Date(),
      },
    });

    // Воркер перезапустился, BullMQ вернул job
    const h = makeHarness();
    await runGenerationPipeline(h.deps, id);

    expect(h.router.submit).not.toHaveBeenCalled(); // пересабмита нет
    expect(h.router.poll).toHaveBeenCalledWith("fal", "m1::req");
    const gen = await prisma.generation.findUniqueOrThrow({ where: { id } });
    expect(gen.status).toBe("SUCCEEDED");
    expect(await prisma.ledgerEntry.count({ where: { idempotencyKey: `commit:${id}` } })).toBe(1);
    expect(await balances(userId)).toEqual({ balance: 45n, reserved: 0n });

    // повторный прогон (job перезакинули) не дублирует списание
    const h2 = makeHarness();
    await runGenerationPipeline(h2.deps, id);
    expect(await prisma.ledgerEntry.count({ where: { idempotencyKey: `commit:${id}` } })).toBe(1);
    expect(await balances(userId)).toEqual({ balance: 45n, reserved: 0n });
  });

  it("повторный job после SUCCEEDED → no-op", async () => {
    const userId = await createUserWithBalance(50n);
    const id = await createGeneration(userId);
    const h = makeHarness();
    await runGenerationPipeline(h.deps, id);
    const eventsBefore = h.events.length;

    await runGenerationPipeline(h.deps, id);
    expect(h.events.length).toBe(eventsBefore);
    expect(h.router.submit).toHaveBeenCalledTimes(1);
    expect(await prisma.ledgerEntry.count({ where: { idempotencyKey: `commit:${id}` } })).toBe(1);
  });

  it("дедлайн поллинга → FAILED PROVIDER_TIMEOUT + release", async () => {
    const userId = await createUserWithBalance(50n);
    const id = await createGeneration(userId);
    const h = makeHarness({ pollOverrides: { intervalMs: 1, deadlineMs: 1 } });
    h.router.poll.mockResolvedValue({ status: "running" });

    await runGenerationPipeline(h.deps, id);

    const gen = await prisma.generation.findUniqueOrThrow({ where: { id } });
    expect(gen).toMatchObject({ status: "FAILED", errorCode: "PROVIDER_TIMEOUT" });
    expect(await balances(userId)).toEqual({ balance: 50n, reserved: 0n });
  });

  it("отмена во время поллинга: router.cancel вызван, денег не двигали", async () => {
    const userId = await createUserWithBalance(50n);
    const id = await createGeneration(userId);
    const h = makeHarness();
    let pollCount = 0;
    h.router.poll.mockImplementation(async () => {
      pollCount += 1;
      if (pollCount === 1) {
        // между тиками пользователь отменил (api уже сделал release)
        await prisma.generation.update({ where: { id }, data: { status: "CANCELED" } });
        await ledger.release(userId, 5n, { refType: "generation", refId: id }, `release:${id}`);
      }
      return { status: "running" };
    });

    await runGenerationPipeline(h.deps, id);

    expect(h.router.cancel).toHaveBeenCalledWith("fal", "m1::req");
    const gen = await prisma.generation.findUniqueOrThrow({ where: { id } });
    expect(gen.status).toBe("CANCELED");
    expect(await balances(userId)).toEqual({ balance: 50n, reserved: 0n });
    expect(await prisma.ledgerEntry.count({ where: { userId, type: "SPEND" } })).toBe(0);
  });

  it("исключение submit (все звенья упали) → FAILED с кодом провайдера + release", async () => {
    const userId = await createUserWithBalance(50n);
    const id = await createGeneration(userId);
    const h = makeHarness();
    const { ProviderError } = await import("@kadr/providers");
    h.router.submit.mockRejectedValue(
      new ProviderError("UPSTREAM_OVERLOAD", "fal", "m1", "429 everywhere"),
    );

    await runGenerationPipeline(h.deps, id);

    const gen = await prisma.generation.findUniqueOrThrow({ where: { id } });
    expect(gen).toMatchObject({ status: "FAILED", errorCode: "UPSTREAM_OVERLOAD" });
    expect(await balances(userId)).toEqual({ balance: 50n, reserved: 0n });
  });
});

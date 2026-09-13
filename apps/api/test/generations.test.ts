import { randomUUID } from "node:crypto";
import { QUEUE, genChannel } from "@kadr/shared";
import { Queue } from "bullmq";
import Redis from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, type TestContext } from "./app";

let ctx: TestContext;
let queue: Queue;
let queueRedis: Redis;

beforeAll(async () => {
  ctx = await createTestApp();
  queueRedis = new Redis(ctx.config.REDIS_URL, { maxRetriesPerRequest: null });
  queue = new Queue(QUEUE.GENERATION, { connection: queueRedis });
});

beforeEach(async () => {
  await ctx.reset();
  await queue.obliterate({ force: true }).catch(() => undefined);
});

afterAll(async () => {
  await queue.close();
  await queueRedis.quit();
  await ctx.close();
});

const http = () => request(ctx.app.getHttpServer());
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function login(id: number): Promise<{ access: string; userId: string }> {
  const res = await http()
    .post("/v1/auth/telegram-mini-app")
    .send({ initData: ctx.initData({ id, first_name: `u${id}` }) })
    .expect(200);
  return { access: res.body.tokens.accessToken, userId: res.body.user.id };
}

/** Начисляет кредиты через ежедневный бонус нельзя (мало) — грантим напрямую через ledger SQL нельзя. Используем LedgerService. */
async function grant(userId: string, amount: bigint): Promise<void> {
  const { LedgerService } = await import("@kadr/ledger");
  const ledger = new LedgerService(ctx.prisma);
  await ledger.grant(
    userId,
    amount,
    "MANUAL",
    { refType: "test", refId: randomUUID() },
    `test-grant:${randomUUID()}`,
  );
}

function post(access: string, body: Record<string, unknown>, idemKey?: string) {
  const req = http().post("/v1/generations").set(auth(access));
  if (idemKey) req.set("idempotency-key", idemKey);
  return req.send(body);
}

const draftBody = { operationKey: "image_draft", prompt: "рыжий кот в очках" };

describe("POST /v1/generations", () => {
  it("без Idempotency-Key → 400; с ключом → 201, резерв, job в очереди", async () => {
    const { access, userId } = await login(9001);
    await grant(userId, 100n);

    const noKey = await post(access, draftBody).expect(400);
    expect(noKey.body.error.details.reason).toBe("idempotency_key_header_required");

    const res = await post(access, draftBody, "key-1").expect(201);
    expect(res.body).toMatchObject({
      status: "QUEUED",
      costCredits: 5,
      balanceAfterReserve: "145",
    });

    const gen = await ctx.prisma.generation.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(gen).toMatchObject({
      userId,
      operationKey: "image_draft",
      kind: "IMAGE",
      costCredits: 5,
    });
    const account = await ctx.prisma.creditAccount.findUniqueOrThrow({ where: { userId } });
    expect(account).toMatchObject({ balance: 145n, reserved: 5n });

    const job = await queue.getJob(res.body.id);
    expect(job?.data).toEqual({ generationId: res.body.id });
  });

  it("двойной POST с одним ключом → одна генерация, один резерв, второй ответ 200", async () => {
    const { access, userId } = await login(9002);
    await grant(userId, 100n);

    const [a, b] = [
      await post(access, draftBody, "same-key").expect(201),
      await post(access, draftBody, "same-key").expect(200),
    ];
    expect(b.body.id).toBe(a.body.id);
    expect(await ctx.prisma.generation.count()).toBe(1);
    const account = await ctx.prisma.creditAccount.findUniqueOrThrow({ where: { userId } });
    expect(account.reserved).toBe(5n); // резерв один

    // параллельный дубль
    const [c, d] = await Promise.all([
      post(access, draftBody, "race-key"),
      post(access, draftBody, "race-key"),
    ]);
    expect([c.status, d.status].sort()).toEqual([200, 201]);
    expect(await ctx.prisma.generation.count()).toBe(2);
  });

  it("нехватка кредитов → 402 с missing, строка генерации не остаётся", async () => {
    const { access, userId } = await login(9003);
    // стартовый бонус 50; video_5s стоит 79
    const res = await post(access, { operationKey: "video_5s", prompt: "море" }, "k").expect(402);
    expect(res.body.error).toMatchObject({
      code: "INSUFFICIENT_CREDITS",
      details: { missing: "29" },
    });
    expect(await ctx.prisma.generation.count()).toBe(0);
    const account = await ctx.prisma.creditAccount.findUniqueOrThrow({ where: { userId } });
    expect(account).toMatchObject({ balance: 50n, reserved: 0n });
  });

  it("валидация: params по схеме операции, variants только IMAGE, XOR prompt/preset", async () => {
    const { access, userId } = await login(9004);
    await grant(userId, 1000n);

    const badParams = await post(
      access,
      { ...draftBody, params: { aspect_ratio: "21:9" } },
      "k1",
    ).expect(400);
    expect(badParams.body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(badParams.body.error.details)).toContain("aspect_ratio");

    const videoVariants = await post(
      access,
      { operationKey: "video_5s", prompt: "x", variants: 3 },
      "k2",
    ).expect(400);
    expect(videoVariants.body.error.details.reason).toBe("variants_only_for_images");

    await post(access, { operationKey: "image_draft" }, "k3").expect(400); // ни prompt, ни preset
    await post(access, { operationKey: "image_draft", prompt: "x", presetId: "p" }, "k4").expect(
      400,
    );

    const unknownOp = await post(access, { operationKey: "nope", prompt: "x" }, "k5").expect(404);
    expect(unknownOp.body.error.code).toBe("NOT_FOUND");

    // variants=3 image → cost 15
    const ok = await post(access, { ...draftBody, variants: 3 }, "k6").expect(201);
    expect(ok.body.costCredits).toBe(15);
  });
});

describe("чтение, удаление, cancel", () => {
  it("GET чужой генерации → 404; список без deleted, с фильтром kind и курсором", async () => {
    const alice = await login(9101);
    const bob = await login(9102);
    await grant(alice.userId, 1000n);

    const g1 = (await post(alice.access, draftBody, "g1").expect(201)).body.id;
    const g2 = (
      await post(alice.access, { operationKey: "video_5s", prompt: "v" }, "g2").expect(201)
    ).body.id;
    const g3 = (await post(alice.access, draftBody, "g3").expect(201)).body.id;

    await http().get(`/v1/generations/${g1}`).set(auth(bob.access)).expect(404);
    await http().get(`/v1/generations/${g1}`).set(auth(alice.access)).expect(200);

    await http().delete(`/v1/generations/${g3}`).set(auth(alice.access)).expect(204);
    const list = await http().get("/v1/generations").set(auth(alice.access)).expect(200);
    expect(list.body.items.map((g: { id: string }) => g.id)).toEqual([g2, g1]);

    const videos = await http()
      .get("/v1/generations?kind=VIDEO")
      .set(auth(alice.access))
      .expect(200);
    expect(videos.body.items.map((g: { id: string }) => g.id)).toEqual([g2]);

    const page1 = await http().get("/v1/generations?limit=1").set(auth(alice.access)).expect(200);
    expect(page1.body.items).toHaveLength(1);
    const page2 = await http()
      .get(`/v1/generations?limit=5&cursor=${page1.body.nextCursor}`)
      .set(auth(alice.access))
      .expect(200);
    expect(page2.body.items.map((g: { id: string }) => g.id)).toEqual([g1]);
    expect(page2.body.nextCursor).toBeNull();
  });

  it("cancel QUEUED → CANCELED + возврат резерва; cancel RUNNING → 409", async () => {
    const { access, userId } = await login(9103);
    await grant(userId, 100n);
    const id = (await post(access, draftBody, "c1").expect(201)).body.id;

    const canceled = await http()
      .post(`/v1/generations/${id}/cancel`)
      .set(auth(access))
      .expect(200);
    expect(canceled.body.status).toBe("CANCELED");
    const account = await ctx.prisma.creditAccount.findUniqueOrThrow({ where: { userId } });
    expect(account).toMatchObject({ balance: 150n, reserved: 0n });
    // повторный cancel уже терминальной → 409
    await http().post(`/v1/generations/${id}/cancel`).set(auth(access)).expect(409);

    const id2 = (await post(access, draftBody, "c2").expect(201)).body.id;
    await ctx.prisma.generation.update({ where: { id: id2 }, data: { status: "RUNNING" } });
    const denied = await http().post(`/v1/generations/${id2}/cancel`).set(auth(access)).expect(409);
    expect(denied.body.error).toMatchObject({
      code: "ILLEGAL_TRANSITION",
      details: { reason: "cancel_not_allowed", status: "RUNNING" },
    });
  });
});

describe("SSE /v1/generations/:id/events", () => {
  it("отдаёт снапшот, доставляет событие из Redis и закрывается на терминальном статусе", async () => {
    const { access, userId } = await login(9201);
    await grant(userId, 100n);
    const id = (await post(access, draftBody, "sse1").expect(201)).body.id;

    const chunks: string[] = [];
    const req = http()
      .get(`/v1/generations/${id}/events`)
      .set(auth(access))
      .buffer(false)
      .parse((res, cb) => {
        res.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
        res.on("end", () => cb(null, chunks.join("")));
      });

    const done = new Promise<void>((resolve, reject) => {
      req.end((err) => (err ? reject(err) : resolve()));
    });

    // подождать снапшот, затем опубликовать прогресс и терминал
    await waitFor(() => chunks.join("").includes('"QUEUED"'));
    const publisher = new Redis(ctx.config.REDIS_URL);
    await publisher.publish(
      genChannel(id),
      JSON.stringify({ id, status: "RUNNING", progress: 42, ts: Date.now() }),
    );
    await waitFor(() => chunks.join("").includes('"progress":42'));
    await publisher.publish(
      genChannel(id),
      JSON.stringify({ id, status: "SUCCEEDED", resultUrls: ["https://x/1.png"], ts: Date.now() }),
    );
    await done; // поток закрылся по терминальному статусу
    await publisher.quit();

    const raw = chunks.join("");
    const statuses = [...raw.matchAll(/"status":"(\w+)"/g)].map((m) => m[1]);
    expect(statuses).toEqual(["QUEUED", "RUNNING", "SUCCEEDED"]);
  });

  it("SSE на терминальной генерации отдаёт снапшот и сразу закрывается; чужая → 404", async () => {
    const owner = await login(9202);
    const stranger = await login(9203);
    await grant(owner.userId, 100n);
    const id = (await post(owner.access, draftBody, "sse2").expect(201)).body.id;
    await ctx.prisma.generation.update({
      where: { id },
      data: { status: "FAILED", errorCode: "PROVIDER_ERROR" },
    });

    await http().get(`/v1/generations/${id}/events`).set(auth(stranger.access)).expect(404);
    const res = await http()
      .get(`/v1/generations/${id}/events`)
      .set(auth(owner.access))
      .expect(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.text).toContain('"FAILED"');
  });
});

async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
}

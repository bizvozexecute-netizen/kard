import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signWidgetLogin } from "../src/auth/testing/telegram-fixtures";
import { createTestApp, TEST_BOT_TOKEN, type TestContext } from "./app";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});

beforeEach(async () => {
  await ctx.reset();
});

afterAll(async () => {
  await ctx.close();
});

const http = () => request(ctx.app.getHttpServer());
const nowSec = () => Math.floor(ctx.clock.now.getTime() / 1000);

describe("POST /v1/auth/telegram-mini-app", () => {
  it("создаёт пользователя, счёт и бонус 50; повторный вход не дублирует бонус", async () => {
    const initData = ctx.initData({ id: 1001, first_name: "Иван", username: "ivan" });

    const first = await http().post("/v1/auth/telegram-mini-app").send({ initData }).expect(200);
    expect(first.body.isNew).toBe(true);
    expect(first.body.user).toMatchObject({
      tgId: "1001",
      name: "Иван",
      username: "ivan",
      balance: "50",
      reserved: "0",
      streak: { days: 0, todayClaimed: false },
    });
    expect(first.body.user.referralCode).toMatch(/^[1-9A-HJ-NP-Za-km-z]{8}$/);
    expect(first.body.tokens.accessToken).toBeTypeOf("string");

    const second = await http().post("/v1/auth/telegram-mini-app").send({ initData }).expect(200);
    expect(second.body.isNew).toBe(false);
    expect(second.body.user.balance).toBe("50");

    const entries = await ctx.prisma.ledgerEntry.findMany({ where: { refType: "signup" } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "BONUS",
      delta: 50n,
      idempotencyKey: `signup:${first.body.user.id}`,
    });
    expect(await ctx.prisma.user.count()).toBe(1);
    expect(await ctx.prisma.creditAccount.count()).toBe(1);
  });

  it("три параллельных первых входа → один пользователь, один бонус", async () => {
    const initData = ctx.initData({ id: 1002, first_name: "Гонка" });
    const responses = await Promise.all(
      [1, 2, 3].map(() => http().post("/v1/auth/telegram-mini-app").send({ initData })),
    );
    for (const r of responses) expect(r.status).toBe(200);
    expect(responses.filter((r) => r.body.isNew).length).toBe(1);
    expect(await ctx.prisma.user.count()).toBe(1);
    expect(await ctx.prisma.ledgerEntry.count({ where: { refType: "signup" } })).toBe(1);
    const balance = await ctx.prisma.creditAccount.findFirstOrThrow();
    expect(balance.balance).toBe(50n);
  });

  it("start_param=ref_<code> проставляет referredBy; свой и неизвестный код игнорируются", async () => {
    const inviter = await http()
      .post("/v1/auth/telegram-mini-app")
      .send({ initData: ctx.initData({ id: 2001, first_name: "Инвайтер" }) })
      .expect(200);
    const code: string = inviter.body.user.referralCode;

    const invited = await http()
      .post("/v1/auth/telegram-mini-app")
      .send({
        initData: ctx.initData({ id: 2002, first_name: "Гость" }, { startParam: `ref_${code}` }),
      })
      .expect(200);
    const invitedRow = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: invited.body.user.id },
    });
    expect(invitedRow.referredBy).toBe(inviter.body.user.id);

    // повторный вход с реф-кодом уже существующего пользователя ничего не меняет
    await http()
      .post("/v1/auth/telegram-mini-app")
      .send({
        initData: ctx.initData({ id: 2001, first_name: "Инвайтер" }, { startParam: `ref_${code}` }),
      })
      .expect(200);
    const inviterRow = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: inviter.body.user.id },
    });
    expect(inviterRow.referredBy).toBeNull();

    const unknown = await http()
      .post("/v1/auth/telegram-mini-app")
      .send({
        initData: ctx.initData({ id: 2003, first_name: "Без" }, { startParam: "ref_ZZZZZZZZ" }),
      })
      .expect(200);
    const unknownRow = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: unknown.body.user.id },
    });
    expect(unknownRow.referredBy).toBeNull();
  });

  it("протухший / подделанный initData → 401 UNAUTHORIZED с причиной", async () => {
    const stale = ctx.initData({ id: 1 }, { authDate: nowSec() - 3601 });
    const r1 = await http()
      .post("/v1/auth/telegram-mini-app")
      .send({ initData: stale })
      .expect(401);
    expect(r1.body.error).toMatchObject({ code: "UNAUTHORIZED", details: { reason: "expired" } });

    const forged = `${ctx.initData({ id: 1 })}x`;
    const r2 = await http()
      .post("/v1/auth/telegram-mini-app")
      .send({ initData: forged })
      .expect(401);
    expect(r2.body.error.details.reason).toBe("bad_signature");

    const r3 = await http().post("/v1/auth/telegram-mini-app").send({}).expect(400);
    expect(r3.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("забаненный пользователь не входит", async () => {
    const initData = ctx.initData({ id: 3001, first_name: "Бан" });
    const res = await http().post("/v1/auth/telegram-mini-app").send({ initData }).expect(200);
    await ctx.prisma.user.update({
      where: { id: res.body.user.id },
      data: { bannedAt: new Date() },
    });
    const again = await http().post("/v1/auth/telegram-mini-app").send({ initData }).expect(401);
    expect(again.body.error.details.reason).toBe("banned");
  });
});

describe("POST /v1/auth/telegram-widget", () => {
  it("валидная подпись → вход, подделка → 401", async () => {
    const payload = signWidgetLogin({
      botToken: TEST_BOT_TOKEN,
      authDate: nowSec(),
      user: { id: 4001, first_name: "Widget", username: "w" },
    });
    const ok = await http().post("/v1/auth/telegram-widget").send(payload).expect(200);
    expect(ok.body.user).toMatchObject({ tgId: "4001", username: "w", balance: "50" });

    const bad = await http()
      .post("/v1/auth/telegram-widget")
      .send({ ...payload, username: "hacker" })
      .expect(401);
    expect(bad.body.error.details.reason).toBe("bad_signature");
  });
});

describe("POST /v1/auth/refresh", () => {
  it("ротация: новая пара, старый refresh отозван, новый access работает", async () => {
    const login = await http()
      .post("/v1/auth/telegram-mini-app")
      .send({ initData: ctx.initData({ id: 5001 }) })
      .expect(200);
    const { refreshToken } = login.body.tokens;

    const rotated = await http().post("/v1/auth/refresh").send({ refreshToken }).expect(200);
    expect(rotated.body.refreshToken).not.toBe(refreshToken);

    const reused = await http().post("/v1/auth/refresh").send({ refreshToken }).expect(401);
    expect(reused.body.error.details.reason).toBe("refresh_revoked");

    await http()
      .get("/v1/me")
      .set("authorization", `Bearer ${rotated.body.accessToken}`)
      .expect(200);
  });
});

describe("защита и rate limit", () => {
  it("/v1/me без токена → 401, с мусорным токеном → 401", async () => {
    const r1 = await http().get("/v1/me").expect(401);
    expect(r1.body.error).toMatchObject({
      code: "UNAUTHORIZED",
      details: { reason: "missing_token" },
    });
    const r2 = await http().get("/v1/me").set("authorization", "Bearer nope").expect(401);
    expect(r2.body.error.details.reason).toBe("invalid_token");
    await http().get("/v1/health").expect(200);
  });

  it("11-й запрос на /v1/auth/* за минуту с одного IP → 429 RATE_LIMITED", async () => {
    const initData = ctx.initData({ id: 6001 });
    for (let i = 0; i < 10; i++) {
      await http()
        .post("/v1/auth/telegram-mini-app")
        .set("x-forwarded-for", "203.0.113.7")
        .send({ initData })
        .expect(200);
    }
    const blocked = await http()
      .post("/v1/auth/telegram-mini-app")
      .set("x-forwarded-for", "203.0.113.7")
      .send({ initData })
      .expect(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");

    // другой IP не затронут
    await http()
      .post("/v1/auth/telegram-mini-app")
      .set("x-forwarded-for", "203.0.113.8")
      .send({ initData })
      .expect(200);
  });
});

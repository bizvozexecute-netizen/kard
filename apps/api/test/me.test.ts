import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, type TestContext } from "./app";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});

beforeEach(async () => {
  await ctx.reset();
  ctx.clock.now = new Date("2026-03-01T12:00:00Z");
});

afterAll(async () => {
  await ctx.close();
});

const http = () => request(ctx.app.getHttpServer());

async function login(id: number): Promise<{ access: string; userId: string }> {
  const res = await http()
    .post("/v1/auth/telegram-mini-app")
    .send({ initData: ctx.initData({ id, first_name: `u${id}` }) })
    .expect(200);
  return { access: res.body.tokens.accessToken, userId: res.body.user.id };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe("GET/PATCH /v1/me", () => {
  it("отдаёт профиль, баланс из ledger и стрик", async () => {
    const { access, userId } = await login(7001);
    const me = await http().get("/v1/me").set(auth(access)).expect(200);
    expect(me.body).toMatchObject({
      id: userId,
      tgId: "7001",
      balance: "50",
      reserved: "0",
      email: null,
      notificationsEnabled: true,
      streak: { days: 0, todayClaimed: false },
    });
  });

  it("PATCH меняет email и notificationsEnabled; невалидный email → 400; пустое тело → 400", async () => {
    const { access } = await login(7002);
    const ok = await http()
      .patch("/v1/me")
      .set(auth(access))
      .send({ email: "User@Example.com", notificationsEnabled: false })
      .expect(200);
    expect(ok.body).toMatchObject({ email: "user@example.com", notificationsEnabled: false });

    const bad = await http().patch("/v1/me").set(auth(access)).send({ email: "nope" }).expect(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
    await http().patch("/v1/me").set(auth(access)).send({}).expect(400);
  });
});

describe("POST /v1/me/daily-claim", () => {
  it("первый клейм → 5 кредитов, повтор в тот же день → 409 ALREADY_CLAIMED без начисления", async () => {
    const { access, userId } = await login(8001);
    const first = await http().post("/v1/me/daily-claim").set(auth(access)).expect(200);
    expect(first.body).toEqual({
      credited: "5",
      streak: { days: 1, todayClaimed: true },
      balance: "55",
      date: "2026-03-01",
    });

    const again = await http().post("/v1/me/daily-claim").set(auth(access)).expect(409);
    expect(again.body.error).toMatchObject({
      code: "ALREADY_CLAIMED",
      details: { date: "2026-03-01", nextClaimAt: "2026-03-02T00:00:00.000Z" },
    });
    expect(await ctx.prisma.ledgerEntry.count({ where: { userId, type: "DAILY" } })).toBe(1);
    const me = await http().get("/v1/me").set(auth(access)).expect(200);
    expect(me.body).toMatchObject({ balance: "55", streak: { days: 1, todayClaimed: true } });
  });

  it("гонка: 2 параллельных клейма → одно начисление, один 200 и один 409", async () => {
    const { access, userId } = await login(8002);
    const [a, b] = await Promise.all([
      http().post("/v1/me/daily-claim").set(auth(access)),
      http().post("/v1/me/daily-claim").set(auth(access)),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await ctx.prisma.ledgerEntry.count({ where: { userId, type: "DAILY" } })).toBe(1);
    expect(await ctx.prisma.dailyClaim.count({ where: { userId } })).toBe(1);
    const account = await ctx.prisma.creditAccount.findUniqueOrThrow({ where: { userId } });
    expect(account.balance).toBe(55n);
  });

  it("стрик через границу дат: дни 1–6 по 5, день 7 → 15, пропуск дня → сброс", async () => {
    const { access, userId } = await login(8003);
    const credited: string[] = [];
    for (let day = 0; day < 7; day++) {
      ctx.clock.now = new Date(Date.UTC(2026, 2, 1 + day, 23, 30)); // 1..7 марта, поздний вечер UTC
      const res = await http().post("/v1/me/daily-claim").set(auth(access)).expect(200);
      credited.push(res.body.credited);
      expect(res.body.streak.days).toBe(day + 1);
    }
    expect(credited).toEqual(["5", "5", "5", "5", "5", "5", "15"]);

    // 8 марта в 00:10 UTC — новый день сразу после полуночи, серия продолжается
    ctx.clock.now = new Date(Date.UTC(2026, 2, 8, 0, 10));
    const day8 = await http().post("/v1/me/daily-claim").set(auth(access)).expect(200);
    expect(day8.body).toMatchObject({ credited: "15", streak: { days: 8, todayClaimed: true } });

    // /me на следующий день без клейма: серия ещё жива (вчера был клейм)
    ctx.clock.now = new Date(Date.UTC(2026, 2, 9, 12));
    const alive = await http().get("/v1/me").set(auth(access)).expect(200);
    expect(alive.body.streak).toEqual({ days: 8, todayClaimed: false });

    // пропуск 9 марта → 10 марта серия обнуляется и начинается заново с 1
    ctx.clock.now = new Date(Date.UTC(2026, 2, 10, 12));
    const dead = await http().get("/v1/me").set(auth(access)).expect(200);
    expect(dead.body.streak).toEqual({ days: 0, todayClaimed: false });
    const restart = await http().post("/v1/me/daily-claim").set(auth(access)).expect(200);
    expect(restart.body).toMatchObject({ credited: "5", streak: { days: 1, todayClaimed: true } });

    const streak = await ctx.prisma.streak.findUniqueOrThrow({ where: { userId } });
    expect(streak).toMatchObject({ current: 1, best: 8, lastClaimDate: "2026-03-10" });
    // 5*6 + 15 + 15 + 5 = 65 начислено сверх 50
    const account = await ctx.prisma.creditAccount.findUniqueOrThrow({ where: { userId } });
    expect(account.balance).toBe(115n);
  });
});

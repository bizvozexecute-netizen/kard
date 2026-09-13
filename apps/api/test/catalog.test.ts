import { catalogResponseSchema, packagesResponseSchema } from "@kadr/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, type TestContext } from "./app";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});

beforeEach(async () => {
  // каталог сидится миграцией и тестами не очищается; сбрасываем только кэш
  await ctx.redis.flushdb();
  await ctx.prisma.operation.updateMany({ data: { isActive: true } });
  await ctx.prisma.package.updateMany({ data: { isActive: true } });
});

afterAll(async () => {
  await ctx.close();
});

const http = () => request(ctx.app.getHttpServer());

describe("GET /v1/catalog", () => {
  it("публичный: 9 операций сида в порядке sort, без внутренних полей", async () => {
    const res = await http().get("/v1/catalog").expect(200);
    const parsed = catalogResponseSchema.parse(res.body);
    expect(parsed.operations.map((o) => o.key)).toEqual([
      "image_draft",
      "image_standard",
      "image_premium",
      "image_edit",
      "upscale_x4",
      "video_5s",
      "video_5s_audio",
      "video_10s_premium",
      "music_2min",
    ]);
    const draft = parsed.operations[0]!;
    expect(draft).toMatchObject({ kind: "IMAGE", tier: "DRAFT", priceCredits: 5, etaSec: 5 });
    expect(draft.paramsSchema).toMatchObject({ type: "object" });
    expect(JSON.stringify(res.body)).not.toMatch(/cogs|provider_chain|providerChain/i);
    const video = parsed.operations.find((o) => o.key === "video_5s_audio")!;
    expect(video).toMatchObject({ kind: "VIDEO", tier: "PREMIUM", priceCredits: 179 });
  });

  it("кэш 60 с: изменение в БД видно только после инвалидации; TTL ≤ 60", async () => {
    await http().get("/v1/catalog").expect(200); // прогрев
    await ctx.prisma.operation.update({ where: { key: "music_2min" }, data: { isActive: false } });

    const cached = await http().get("/v1/catalog").expect(200);
    expect(cached.body.operations.map((o: { key: string }) => o.key)).toContain("music_2min");

    const ttl = await ctx.redis.ttl("cache:catalog:v1");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);

    await ctx.redis.del("cache:catalog:v1");
    const fresh = await http().get("/v1/catalog").expect(200);
    expect(fresh.body.operations.map((o: { key: string }) => o.key)).not.toContain("music_2min");
    expect(fresh.body.operations).toHaveLength(8);
  });
});

describe("GET /v1/packages", () => {
  it("публичный: 5 пакетов сида, badge у 999, credits строками", async () => {
    const res = await http().get("/v1/packages").expect(200);
    const parsed = packagesResponseSchema.parse(res.body);
    expect(parsed.packages.map((p) => [p.priceRub, p.credits, p.bonusPct])).toEqual([
      [199, "199", 0],
      [499, "549", 10],
      [999, "1150", 15],
      [2490, "3000", 20],
      [4990, "6250", 25],
    ]);
    expect(parsed.packages.find((p) => p.priceRub === 999)?.badge).toBe("Популярный");
    expect(parsed.packages.filter((p) => p.priceRub !== 999).every((p) => p.badge === null)).toBe(
      true,
    );
  });

  it("кэш пакетов инвалидируется по ключу", async () => {
    await http().get("/v1/packages").expect(200);
    await ctx.prisma.package.update({ where: { id: "pkg_199" }, data: { isActive: false } });
    const cached = await http().get("/v1/packages").expect(200);
    expect(cached.body.packages).toHaveLength(5);

    await ctx.redis.del("cache:packages:v1");
    const fresh = await http().get("/v1/packages").expect(200);
    expect(fresh.body.packages).toHaveLength(4);
  });
});

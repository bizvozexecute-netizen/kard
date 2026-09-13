import "reflect-metadata";
import { Prisma, type Operation, type Package } from "@kadr/db";
import { catalogOperationSchema, packageSchema } from "@kadr/shared";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";
import type { RedisService } from "../redis/redis.service";
import { CatalogCache, CATALOG_CACHE_TTL_SEC } from "./catalog-cache";
import { toOperationDto, toPackageDto } from "./catalog.service";

const logger = { setContext: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;

function fakeRedis(overrides: Partial<Record<"get" | "set" | "del", unknown>> = {}) {
  return {
    status: "ready",
    connect: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    ...overrides,
  } as unknown as RedisService & {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  };
}

describe("CatalogCache", () => {
  it("промах: зовёт loader и пишет значение с TTL 60", async () => {
    const redis = fakeRedis();
    const cache = new CatalogCache(redis, logger);
    const loader = vi.fn().mockResolvedValue({ a: 1 });

    const value = await cache.getOrLoad("k", loader);

    expect(value).toEqual({ a: 1 });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      "k",
      JSON.stringify({ a: 1 }),
      "EX",
      CATALOG_CACHE_TTL_SEC,
    );
  });

  it("попадание: loader не вызывается", async () => {
    const redis = fakeRedis({ get: vi.fn().mockResolvedValue('{"a":2}') });
    const cache = new CatalogCache(redis, logger);
    const loader = vi.fn();

    expect(await cache.getOrLoad("k", loader)).toEqual({ a: 2 });
    expect(loader).not.toHaveBeenCalled();
  });

  it("ошибка Redis не роняет запрос: ответ из loader", async () => {
    const redis = fakeRedis({
      get: vi.fn().mockRejectedValue(new Error("down")),
      set: vi.fn().mockRejectedValue(new Error("down")),
    });
    const cache = new CatalogCache(redis, logger);

    expect(await cache.getOrLoad("k", async () => ({ ok: true }))).toEqual({ ok: true });
  });

  it("битый JSON в кэше → перечитывание из loader", async () => {
    const redis = fakeRedis({ get: vi.fn().mockResolvedValue("{oops") });
    const cache = new CatalogCache(redis, logger);
    expect(await cache.getOrLoad("k", async () => "fresh")).toBe("fresh");
    expect(redis.set).toHaveBeenCalled();
  });

  it("invalidate удаляет ключ", async () => {
    const redis = fakeRedis();
    await new CatalogCache(redis, logger).invalidate("k");
    expect(redis.del).toHaveBeenCalledWith("k");
  });
});

describe("маппинг DTO", () => {
  it("операция: без cogsUsdEst и providerChain, схема shared проходит", () => {
    const op: Operation = {
      key: "image_draft",
      kind: "IMAGE",
      tier: "DRAFT",
      title: "Изображение — черновик",
      priceCredits: 5,
      cogsUsdEst: new Prisma.Decimal("0.003"),
      providerChain: [{ provider: "fal", model: "fal-ai/flux/schnell" }],
      paramsSchema: { type: "object" },
      etaSec: 5,
      isActive: true,
      sort: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const dto = toOperationDto(op);
    expect(catalogOperationSchema.parse(dto)).toEqual(dto);
    expect(dto).not.toHaveProperty("cogsUsdEst");
    expect(dto).not.toHaveProperty("providerChain");
    expect(JSON.stringify(dto)).not.toContain("0.003");
  });

  it("пакет: credits BigInt → строка", () => {
    const pkg: Package = {
      id: "pkg_999",
      priceRub: 999,
      credits: 1150n,
      bonusPct: 15,
      badge: "Популярный",
      isActive: true,
      sort: 30,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const dto = toPackageDto(pkg);
    expect(packageSchema.parse(dto)).toEqual(dto);
    expect(dto.credits).toBe("1150");
  });
});

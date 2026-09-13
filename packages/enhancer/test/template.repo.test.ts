import { PrismaClient } from "@kadr/db";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { ENHANCER_TEMPLATE_KEY, PrismaTemplateSource } from "../src";

let prisma: PrismaClient;

beforeAll(() => {
  prisma = new PrismaClient({ datasources: { db: { url: inject("dbUrl") } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PrismaTemplateSource (реальный Postgres)", () => {
  it("сид enhancer_system v1 присутствует и читается", async () => {
    const source = new PrismaTemplateSource(prisma);
    const body = await source.getActiveBody(ENHANCER_TEMPLATE_KEY);
    expect(body).toContain("prompt_en");
    expect(body).toContain("Russian");
  });

  it("берётся максимальная активная версия; неактивная игнорируется", async () => {
    await prisma.promptTemplate.deleteMany({ where: { key: "t_ver" } });
    await prisma.promptTemplate.createMany({
      data: [
        { key: "t_ver", version: 1, body: "v1", isActive: true },
        { key: "t_ver", version: 2, body: "v2", isActive: true },
        { key: "t_ver", version: 3, body: "v3-disabled", isActive: false },
      ],
    });
    const source = new PrismaTemplateSource(prisma);
    expect(await source.getActiveBody("t_ver")).toBe("v2");
    expect(await source.getActiveBody("t_missing")).toBeNull();
  });

  it("кэширует на TTL и перечитывает после протухания", async () => {
    let clock = 0;
    const spy = vi.spyOn(prisma.promptTemplate, "findFirst");
    const source = new PrismaTemplateSource(prisma, 60_000, () => clock);

    await source.getActiveBody(ENHANCER_TEMPLATE_KEY);
    await source.getActiveBody(ENHANCER_TEMPLATE_KEY);
    expect(spy).toHaveBeenCalledTimes(1);

    clock = 61_000;
    await source.getActiveBody(ENHANCER_TEMPLATE_KEY);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

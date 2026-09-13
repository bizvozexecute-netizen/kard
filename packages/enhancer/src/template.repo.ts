import type { PrismaClient } from "@kadr/db";
import type { TemplateSource } from "./types";

interface CacheEntry {
  body: string | null;
  expiresAt: number;
}

/**
 * Системные промпты из prompt_templates: активная запись с максимальной версией.
 * In-memory кэш на minute — шаблоны меняются редко, а enhance зовётся на каждую генерацию.
 */
export class PrismaTemplateSource implements TemplateSource {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly cacheTtlMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  async getActiveBody(key: string): Promise<string | null> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.body;

    const row = await this.prisma.promptTemplate.findFirst({
      where: { key, isActive: true },
      orderBy: { version: "desc" },
      select: { body: true },
    });
    const body = row?.body ?? null;
    this.cache.set(key, { body, expiresAt: this.now() + this.cacheTtlMs });
    return body;
  }
}

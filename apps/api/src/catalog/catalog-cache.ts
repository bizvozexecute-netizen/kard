import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { RedisService } from "../redis/redis.service";

export const CACHE_KEYS = {
  catalog: "cache:catalog:v1",
  packages: "cache:packages:v1",
} as const;

export const CATALOG_CACHE_TTL_SEC = 60;

/**
 * Кэш read-only ответов каталога в Redis (TTL 60 с, общий на все инстансы api).
 * Ошибки Redis не роняют запрос: промах кэша → загрузка из БД.
 * Инвалидация по ключу — для будущих админ-ручек и тестов.
 */
@Injectable()
export class CatalogCache {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CatalogCache.name);
  }

  async getOrLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = await this.safeGet(key);
    if (cached !== null) {
      try {
        return JSON.parse(cached) as T;
      } catch {
        // повреждённое значение — перечитываем из БД и перезаписываем
      }
    }

    const value = await loader();
    await this.safeSet(key, JSON.stringify(value));
    return value;
  }

  async invalidate(key: string): Promise<void> {
    try {
      await this.connected();
      await this.redis.del(key);
    } catch (err) {
      this.logger.warn({ err, key }, "cache invalidate failed");
    }
  }

  private async safeGet(key: string): Promise<string | null> {
    try {
      await this.connected();
      return await this.redis.get(key);
    } catch (err) {
      this.logger.warn({ err, key }, "cache read failed, falling back to db");
      return null;
    }
  }

  private async safeSet(key: string, value: string): Promise<void> {
    try {
      await this.connected();
      await this.redis.set(key, value, "EX", CATALOG_CACHE_TTL_SEC);
    } catch (err) {
      this.logger.warn({ err, key }, "cache write failed");
    }
  }

  private async connected(): Promise<void> {
    if (this.redis.status === "wait") await this.redis.connect();
  }
}

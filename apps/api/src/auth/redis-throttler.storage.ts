import { Injectable } from "@nestjs/common";
import type { ThrottlerStorage } from "@nestjs/throttler";
import type { ThrottlerStorageRecord } from "@nestjs/throttler/dist/throttler-storage-record.interface";
import { RedisService } from "../redis/redis.service";

const PREFIX = "thr:";

/**
 * Хранилище @nestjs/throttler в Redis: лимит общий для всех инстансов api.
 * INCR + PEXPIRE в одной MULTI; при превышении лимита ставится блок на blockDuration.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (this.redis.status === "wait") await this.redis.connect();

    const hitsKey = `${PREFIX}${throttlerName}:${key}`;
    const blockKey = `${hitsKey}:blocked`;

    const blockedTtl = await this.redis.pttl(blockKey);
    if (blockedTtl > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: Math.ceil(blockedTtl / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockedTtl / 1000),
      };
    }

    const results = await this.redis.multi().incr(hitsKey).pttl(hitsKey).exec();
    const totalHits = Number(results?.[0]?.[1] ?? 0);
    let remainingMs = Number(results?.[1]?.[1] ?? -1);
    if (remainingMs < 0) {
      await this.redis.pexpire(hitsKey, ttl);
      remainingMs = ttl;
    }

    if (totalHits > limit) {
      const block = blockDuration > 0 ? blockDuration : ttl;
      await this.redis.set(blockKey, "1", "PX", block);
      return {
        totalHits,
        timeToExpire: Math.ceil(remainingMs / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(block / 1000),
      };
    }

    return {
      totalHits,
      timeToExpire: Math.ceil(remainingMs / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}

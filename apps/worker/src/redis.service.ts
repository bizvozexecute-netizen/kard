import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { CONFIG, type WorkerConfig } from "./config";

/** Общее Redis-соединение воркера (circuit breaker, кэши). BullMQ держит свои соединения. */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(@Inject(CONFIG) config: WorkerConfig) {
    super(config.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      connectTimeout: 5_000,
    });
    this.on("error", () => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.status !== "end") await this.quit().catch(() => this.disconnect());
  }
}

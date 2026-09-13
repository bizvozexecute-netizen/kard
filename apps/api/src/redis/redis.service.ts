import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { type AppConfig, CONFIG } from "../config";

/**
 * Один клиент ioredis на приложение (кэш, rate-limit, pub/sub-паблишер).
 * Для BullMQ-продюсеров создаётся отдельное соединение в соответствующем модуле.
 */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(@Inject(CONFIG) config: AppConfig) {
    super(config.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      connectTimeout: 5_000,
    });
    // Ошибки соединения логируются pino через события, не роняют процесс
    this.on("error", () => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.status !== "end") await this.quit().catch(() => this.disconnect());
  }
}

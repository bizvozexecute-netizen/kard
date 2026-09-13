import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { QUEUE } from "@kadr/shared";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { CONFIG, type WorkerConfig } from "../config";
import type { NotifyPayload } from "./pipeline";

/** Продюсер очереди notify (обработчик — сессия 8, бот). */
@Injectable()
export class NotifyQueue implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue<NotifyPayload>;

  constructor(@Inject(CONFIG) config: WorkerConfig) {
    this.connection = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.connection.on("error", () => undefined);
    this.queue = new Queue(QUEUE.NOTIFY, { connection: this.connection });
  }

  async add(job: NotifyPayload): Promise<void> {
    await this.queue.add(job.type, job, { removeOnComplete: 1000, removeOnFail: 1000 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.connection.quit().catch(() => this.connection.disconnect());
  }
}

import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { QUEUE } from "@kadr/shared";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { type AppConfig, CONFIG } from "../config";

/**
 * Продюсер очереди generation. jobId = generationId: BullMQ дедупит повторные
 * enqueue одного и того же job'а (идемпотентный POST безопасно перезакидывает).
 * attempts: 1 — ретраи делает логика процессора, не BullMQ (ТЗ §8).
 */
@Injectable()
export class GenerationQueue implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue<{ generationId: string }>;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.connection = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.connection.on("error", () => undefined);
    this.queue = new Queue(QUEUE.GENERATION, { connection: this.connection });
  }

  async enqueue(generationId: string): Promise<void> {
    await this.queue.add(
      "generate",
      { generationId },
      { jobId: generationId, attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.connection.quit().catch(() => this.connection.disconnect());
  }
}

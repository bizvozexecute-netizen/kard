import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { EnhancerService } from "@kadr/enhancer";
import { LedgerService } from "@kadr/ledger";
import { ProviderRouter } from "@kadr/providers";
import { genChannel, QUEUE } from "@kadr/shared";
import type { StorageLike } from "@kadr/storage";
import { Worker } from "bullmq";
import Redis from "ioredis";
import { PinoLogger } from "nestjs-pino";
import { CONFIG, type WorkerConfig } from "../config";
import { MODERATION, type ModerationService } from "../generations/moderation";
import { NotifyQueue } from "../generations/notify-queue";
import { runGenerationPipeline } from "../generations/pipeline";
import { PrismaService } from "../prisma.service";
import { RedisService } from "../redis.service";
import { STORAGE } from "../storage.provider";

export interface GenerationJobData {
  generationId: string;
}

/**
 * BullMQ Worker очереди `generation`: каждый job прогоняет runGenerationPipeline.
 * Идемпотентность обеспечивает сам пайплайн (проверка статуса, ключи ledger).
 */
@Injectable()
export class GenerationWorker implements OnModuleInit, OnModuleDestroy {
  private connection?: Redis;
  private worker?: Worker<GenerationJobData>;

  constructor(
    @Inject(CONFIG) private readonly config: WorkerConfig,
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly router: ProviderRouter,
    private readonly enhancer: EnhancerService,
    @Inject(MODERATION) private readonly moderation: ModerationService,
    @Inject(STORAGE) private readonly storage: StorageLike,
    private readonly notifyQueue: NotifyQueue,
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(GenerationWorker.name);
  }

  async onModuleInit(): Promise<void> {
    this.connection = new Redis(this.config.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.connection.on("error", (err) => this.logger.error({ err }, "redis connection error"));

    this.worker = new Worker<GenerationJobData>(
      QUEUE.GENERATION,
      (job) => this.process(job.data.generationId),
      { connection: this.connection, concurrency: this.config.WORKER_CONCURRENCY },
    );
    this.worker.on("failed", (job, err) =>
      this.logger.error({ jobId: job?.id, err }, "generation job failed"),
    );
    this.worker.on("error", (err) => this.logger.error({ err }, "worker error"));

    await this.worker.waitUntilReady();
    this.logger.info(
      { queue: QUEUE.GENERATION, concurrency: this.config.WORKER_CONCURRENCY },
      "worker ready",
    );
  }

  private async process(generationId: string): Promise<void> {
    await runGenerationPipeline(
      {
        prisma: this.prisma,
        ledger: this.ledger,
        router: this.router,
        enhancer: this.enhancer,
        moderation: this.moderation,
        storage: this.storage,
        publish: async (event) => {
          if (this.redis.status === "wait") await this.redis.connect();
          await this.redis
            .publish(genChannel(event.id), JSON.stringify(event))
            .catch(() => undefined);
        },
        notify: (job) => this.notifyQueue.add(job),
        logger: this.logger,
      },
      generationId,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.info({ queue: QUEUE.GENERATION }, "worker shutting down, waiting for active jobs");
    await this.worker?.close();
    await this.connection?.quit().catch(() => this.connection?.disconnect());
    this.logger.info("worker stopped");
  }
}

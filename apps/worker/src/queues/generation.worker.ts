import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { QUEUE } from "@kadr/shared";
import { Worker } from "bullmq";
import Redis from "ioredis";
import { PinoLogger } from "nestjs-pino";
import { CONFIG, type WorkerConfig } from "../config";
import { type GenerationJobData, processGenerationJob } from "./generation.processor";

/**
 * BullMQ Worker на очередь `generation`. Поднимается при старте контекста,
 * при остановке дожидается текущих job'ов (graceful shutdown) и закрывает Redis.
 */
@Injectable()
export class GenerationWorker implements OnModuleInit, OnModuleDestroy {
  private connection?: Redis;
  private worker?: Worker<GenerationJobData>;

  constructor(
    @Inject(CONFIG) private readonly config: WorkerConfig,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(GenerationWorker.name);
  }

  async onModuleInit(): Promise<void> {
    // BullMQ требует maxRetriesPerRequest: null для блокирующих команд
    this.connection = new Redis(this.config.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.connection.on("error", (err) => this.logger.error({ err }, "redis connection error"));

    this.worker = new Worker<GenerationJobData>(
      QUEUE.GENERATION,
      (job) => processGenerationJob(job, this.logger),
      { connection: this.connection, concurrency: this.config.WORKER_CONCURRENCY },
    );

    this.worker.on("completed", (job) => this.logger.debug({ jobId: job.id }, "job completed"));
    this.worker.on("failed", (job, err) =>
      this.logger.error({ jobId: job?.id, err }, "job failed"),
    );
    this.worker.on("error", (err) => this.logger.error({ err }, "worker error"));

    await this.worker.waitUntilReady();
    this.logger.info(
      { queue: QUEUE.GENERATION, concurrency: this.config.WORKER_CONCURRENCY },
      "worker ready",
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.info({ queue: QUEUE.GENERATION }, "worker shutting down, waiting for active jobs");
    await this.worker?.close();
    await this.connection?.quit().catch(() => this.connection?.disconnect());
    this.logger.info("worker stopped");
  }
}

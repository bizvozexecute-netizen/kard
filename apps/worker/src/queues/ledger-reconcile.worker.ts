import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { LedgerService } from "@kadr/ledger";
import { QUEUE } from "@kadr/shared";
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { PinoLogger } from "nestjs-pino";
import { CONFIG, type WorkerConfig } from "../config";
import { type LedgerReconcileJobData, processLedgerReconcile } from "./ledger-reconcile.processor";

const SCHEDULER_ID = "hourly";

/**
 * Cron-сверка ledger: BullMQ job scheduler повторяет job раз в LEDGER_RECONCILE_EVERY_MS,
 * этот же процесс его обрабатывает. Scheduler идемпотентен (upsert по id).
 */
@Injectable()
export class LedgerReconcileWorker implements OnModuleInit, OnModuleDestroy {
  private connection?: Redis;
  private queue?: Queue<LedgerReconcileJobData>;
  private worker?: Worker<LedgerReconcileJobData>;

  constructor(
    @Inject(CONFIG) private readonly config: WorkerConfig,
    private readonly ledger: LedgerService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LedgerReconcileWorker.name);
  }

  async onModuleInit(): Promise<void> {
    this.connection = new Redis(this.config.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.connection.on("error", (err) => this.logger.error({ err }, "redis connection error"));

    const every = this.config.LEDGER_RECONCILE_EVERY_MS;
    this.queue = new Queue<LedgerReconcileJobData>(QUEUE.LEDGER_RECONCILE, {
      connection: this.connection,
    });
    await this.queue.upsertJobScheduler(
      SCHEDULER_ID,
      { every },
      {
        name: "reconcile",
        data: { windowMs: every * 2 }, // окно с запасом, чтобы не пропустить границу
        opts: { removeOnComplete: 24, removeOnFail: 24 },
      },
    );

    this.worker = new Worker<LedgerReconcileJobData>(
      QUEUE.LEDGER_RECONCILE,
      (job) => processLedgerReconcile(job.data, this.ledger, this.logger),
      { connection: this.connection, concurrency: 1 },
    );
    this.worker.on("failed", (job, err) =>
      this.logger.error({ jobId: job?.id, err }, "ledger reconcile failed"),
    );
    this.worker.on("error", (err) => this.logger.error({ err }, "worker error"));

    await this.worker.waitUntilReady();
    this.logger.info(
      { queue: QUEUE.LEDGER_RECONCILE, everyMs: every },
      "reconcile scheduler ready",
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit().catch(() => this.connection?.disconnect());
    this.logger.info("reconcile worker stopped");
  }
}

import { type Job } from "bullmq";
import { type PinoLogger } from "nestjs-pino";

/** Полезная нагрузка job'а очереди generation (сессия 6 добавит поля). */
export interface GenerationJobData {
  generationId: string;
}

/**
 * Обработчик job'а — чистая функция, чтобы тестировать без Redis.
 * Пока заглушка: только лог. Реальный пайплайн — сессия 6.
 */
export async function processGenerationJob(
  job: Job<GenerationJobData>,
  logger: PinoLogger,
): Promise<void> {
  logger.info(
    {
      jobId: job.id,
      jobName: job.name,
      generationId: job.data.generationId,
      attempt: job.attemptsMade + 1,
    },
    "generation job received (stub processor)",
  );
}

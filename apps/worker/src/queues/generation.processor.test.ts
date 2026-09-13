import { type Job } from "bullmq";
import { type PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";
import { type GenerationJobData, processGenerationJob } from "./generation.processor";

describe("processGenerationJob", () => {
  it("логирует job и завершается без ошибки", async () => {
    const logger = { info: vi.fn() } as unknown as PinoLogger;
    const job = {
      id: "42",
      name: "generate",
      data: { generationId: "gen_1" },
      attemptsMade: 0,
    } as Job<GenerationJobData>;

    await expect(processGenerationJob(job, logger)).resolves.toBeUndefined();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "42", generationId: "gen_1", attempt: 1 }),
      expect.stringContaining("generation job received"),
    );
  });
});

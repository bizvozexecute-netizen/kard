import type { Provider } from "@nestjs/common";
import { S3Storage } from "@kadr/storage";
import { PinoLogger } from "nestjs-pino";
import { CONFIG, type WorkerConfig } from "./config";

export const STORAGE = Symbol("STORAGE");

export const storageProvider: Provider = {
  provide: STORAGE,
  useFactory: async (config: WorkerConfig, logger: PinoLogger) => {
    const storage = new S3Storage({
      endpoint: config.S3_ENDPOINT,
      accessKey: config.S3_ACCESS_KEY,
      secretKey: config.S3_SECRET_KEY,
      bucket: config.S3_BUCKET,
      onWarn: (message, err) => logger.warn({ err: String(err) }, message),
    });
    // best-effort: uploads/ должны истекать через 30 дней (ТЗ §8)
    await storage.applyLifecycleRules();
    return storage;
  },
  inject: [CONFIG, PinoLogger],
};

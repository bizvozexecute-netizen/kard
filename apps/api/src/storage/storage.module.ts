import { Global, Module } from "@nestjs/common";
import { S3Storage } from "@kadr/storage";
import { PinoLogger } from "nestjs-pino";
import { type AppConfig, CONFIG } from "../config";

/** DI-токен хранилища (S3Storage в проде, in-memory фейк в тестах). */
export const STORAGE = Symbol("STORAGE");

@Global()
@Module({
  providers: [
    {
      provide: STORAGE,
      useFactory: (config: AppConfig, logger: PinoLogger) =>
        new S3Storage({
          endpoint: config.S3_ENDPOINT,
          accessKey: config.S3_ACCESS_KEY,
          secretKey: config.S3_SECRET_KEY,
          bucket: config.S3_BUCKET,
          onWarn: (message, err) => logger.warn({ err: String(err) }, message),
        }),
      inject: [CONFIG, PinoLogger],
    },
  ],
  exports: [STORAGE],
})
export class StorageModule {}

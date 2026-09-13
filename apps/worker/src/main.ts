import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { ConfigValidationError, loadConfig } from "./config";

async function bootstrap(): Promise<void> {
  loadConfig();

  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  // SIGINT/SIGTERM → onModuleDestroy у GenerationWorker (дожидается активных job'ов)
  app.enableShutdownHooks();
  await app.init();
  logger.log("worker started", "Bootstrap");
}

bootstrap().catch((err: unknown) => {
  if (err instanceof ConfigValidationError) {
    console.error(err.message);
  } else {
    console.error("worker failed to start:", err);
  }
  process.exit(1);
});

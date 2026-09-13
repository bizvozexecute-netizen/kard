import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { type AppConfig, CONFIG, ConfigValidationError, loadConfig } from "./config";

async function bootstrap(): Promise<void> {
  // Падаем до создания приложения, если env невалиден (правило 8 CLAUDE.md)
  loadConfig();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.setGlobalPrefix("v1");
  app.enableShutdownHooks();

  const config = app.get<AppConfig>(CONFIG);
  await app.listen(config.PORT);
  logger.log(`api listening on :${config.PORT} (${config.NODE_ENV})`, "Bootstrap");
}

bootstrap().catch((err: unknown) => {
  if (err instanceof ConfigValidationError) {
    console.error(err.message);
  } else {
    console.error("api failed to start:", err);
  }
  process.exit(1);
});

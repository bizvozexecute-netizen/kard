import pino from "pino";
import { createBot } from "./bot";
import { ConfigValidationError, loadConfig } from "./config";

function main(): void {
  const config = loadConfig();
  const logger = pino({
    level: config.LOG_LEVEL,
    base: { app: "bot" },
    transport:
      config.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { singleLine: true, translateTime: "HH:MM:ss.l" } }
        : undefined,
  });

  const bot = createBot(config.BOT_TOKEN, logger);

  const stop = (signal: string) => {
    logger.info({ signal }, "stopping bot");
    void bot.stop().finally(() => process.exit(0));
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));

  // dev/prod пока одинаково: long polling. Webhook-режим для prod — сессия 8.
  void bot.start({
    drop_pending_updates: config.NODE_ENV === "development",
    onStart: (info) => logger.info({ username: info.username }, "bot started (long polling)"),
  });
}

try {
  main();
} catch (err) {
  if (err instanceof ConfigValidationError) {
    console.error(err.message);
  } else {
    console.error("bot failed to start:", err);
  }
  process.exit(1);
}

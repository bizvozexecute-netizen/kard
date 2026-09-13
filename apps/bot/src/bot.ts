import { Bot, type Context } from "grammy";
import { type Logger } from "pino";
import { ru } from "./i18n/ru";

export type BotContext = Context;

/**
 * Собирает бота с обработчиками. Отделено от main.ts, чтобы тестировать
 * без сети: в тестах подменяется transformer bot.api.config.use(...).
 */
export function createBot(token: string, logger: Logger): Bot<BotContext> {
  const bot = new Bot<BotContext>(token);

  bot.command("start", async (ctx) => {
    logger.info({ from: ctx.from?.id, payload: ctx.match || undefined }, "/start");
    await ctx.reply(ru.start);
  });

  // echo на любой текст — заглушка до появления сценариев (сессия 8)
  bot.on("message:text", async (ctx) => {
    await ctx.reply(`${ru.echoPrefix}${ctx.message.text}`);
  });

  bot.catch((err) => {
    logger.error({ err: err.error, update: err.ctx.update.update_id }, "bot handler error");
  });

  return bot;
}

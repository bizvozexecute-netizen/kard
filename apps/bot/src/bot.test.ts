import { type Update, type UserFromGetMe } from "grammy/types";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { createBot } from "./bot";
import { ru } from "./i18n/ru";

// Минимальный botInfo; полный набор флагов Telegram Bot API в тесте не важен
const botInfo = {
  id: 1,
  is_bot: true,
  first_name: "Kadr",
  username: "kadr_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as UserFromGetMe;

function textUpdate(text: string, updateId = 1): Update {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_700_000_000,
      chat: { id: 100, type: "private", first_name: "Test" },
      from: { id: 100, is_bot: false, first_name: "Test" },
      text,
      entities: text.startsWith("/")
        ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }]
        : [],
    },
  };
}

function setup() {
  const bot = createBot("123:test", pino({ level: "silent" }));
  bot.botInfo = botInfo; // не ходим в getMe
  const calls: Array<{ method: string; payload: unknown }> = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    return { ok: true, result: true } as never;
  });
  return { bot, calls };
}

describe("bot", () => {
  it("/start отвечает приветствием из i18n", async () => {
    const { bot, calls } = setup();
    await bot.handleUpdate(textUpdate("/start"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "sendMessage",
      payload: { chat_id: 100, text: ru.start },
    });
  });

  it("/start с deep-link payload тоже отвечает приветствием", async () => {
    const { bot, calls } = setup();
    await bot.handleUpdate(textUpdate("/start ref_abc"));
    expect(calls[0]).toMatchObject({ method: "sendMessage", payload: { text: ru.start } });
  });

  it("обычный текст — echo", async () => {
    const { bot, calls } = setup();
    await bot.handleUpdate(textUpdate("привет", 2));
    expect(calls[0]).toMatchObject({
      method: "sendMessage",
      payload: { text: `${ru.echoPrefix}привет` },
    });
  });
});

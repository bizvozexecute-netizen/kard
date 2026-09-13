import { describe, expect, it } from "vitest";
import { signMiniAppInitData, signWidgetLogin } from "./testing/telegram-fixtures";
import { TelegramAuthError, verifyMiniAppInitData, verifyWidgetLogin } from "./telegram-signature";

const BOT_TOKEN = "123456789:AAEexampleBotTokenForTestsOnly_0000000";
const NOW = new Date("2026-03-01T12:00:00Z");
const nowSec = Math.floor(NOW.getTime() / 1000);

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err instanceof TelegramAuthError ? err.reason : `other:${String(err)}`;
  }
}

describe("verifyMiniAppInitData", () => {
  it("принимает валидную подпись и разбирает профиль и start_param", () => {
    const initData = signMiniAppInitData({
      botToken: BOT_TOKEN,
      authDate: nowSec - 10,
      startParam: "ref_ABCDEFGH",
      user: {
        id: 777,
        first_name: "Иван",
        last_name: "Петров",
        username: "ivan",
        language_code: "ru",
        photo_url: "https://t.me/i/userpic/320/x.jpg",
      },
    });
    const result = verifyMiniAppInitData(initData, BOT_TOKEN, NOW);
    expect(result.profile).toEqual({
      telegramId: 777n,
      firstName: "Иван",
      lastName: "Петров",
      username: "ivan",
      languageCode: "ru",
      photoUrl: "https://t.me/i/userpic/320/x.jpg",
    });
    expect(result.startParam).toBe("ref_ABCDEFGH");
    expect(result.authDate).toBe(nowSec - 10);
  });

  it("протухший auth_date (старше 3600 с) → expired; на границе — ок", () => {
    const stale = signMiniAppInitData({
      botToken: BOT_TOKEN,
      authDate: nowSec - 3601,
      user: { id: 1 },
    });
    expect(reasonOf(() => verifyMiniAppInitData(stale, BOT_TOKEN, NOW))).toBe("expired");
    const edge = signMiniAppInitData({
      botToken: BOT_TOKEN,
      authDate: nowSec - 3600,
      user: { id: 1 },
    });
    expect(verifyMiniAppInitData(edge, BOT_TOKEN, NOW).profile.telegramId).toBe(1n);
  });

  it("auth_date из будущего (> 60 с) → expired", () => {
    const future = signMiniAppInitData({
      botToken: BOT_TOKEN,
      authDate: nowSec + 120,
      user: { id: 1 },
    });
    expect(reasonOf(() => verifyMiniAppInitData(future, BOT_TOKEN, NOW))).toBe("expired");
  });

  it("подделка: чужой токен, изменённый user, изменённый start_param → bad_signature", () => {
    const foreign = signMiniAppInitData({
      botToken: BOT_TOKEN,
      signWithToken: "999:other-token",
      authDate: nowSec,
      user: { id: 1 },
    });
    expect(reasonOf(() => verifyMiniAppInitData(foreign, BOT_TOKEN, NOW))).toBe("bad_signature");

    const valid = signMiniAppInitData({ botToken: BOT_TOKEN, authDate: nowSec, user: { id: 1 } });
    const params = new URLSearchParams(valid);
    params.set("user", JSON.stringify({ id: 2, first_name: "Mallory" }));
    expect(reasonOf(() => verifyMiniAppInitData(params.toString(), BOT_TOKEN, NOW))).toBe(
      "bad_signature",
    );

    const p2 = new URLSearchParams(valid);
    p2.set("start_param", "ref_HACKED00");
    expect(reasonOf(() => verifyMiniAppInitData(p2.toString(), BOT_TOKEN, NOW))).toBe(
      "bad_signature",
    );
  });

  it("без hash / битый hash / без user → malformed или bad_signature", () => {
    const valid = signMiniAppInitData({ botToken: BOT_TOKEN, authDate: nowSec, user: { id: 1 } });
    const noHash = new URLSearchParams(valid);
    noHash.delete("hash");
    expect(reasonOf(() => verifyMiniAppInitData(noHash.toString(), BOT_TOKEN, NOW))).toBe(
      "malformed",
    );

    const shortHash = new URLSearchParams(valid);
    shortHash.set("hash", "abc");
    expect(reasonOf(() => verifyMiniAppInitData(shortHash.toString(), BOT_TOKEN, NOW))).toBe(
      "bad_signature",
    );

    expect(reasonOf(() => verifyMiniAppInitData("", BOT_TOKEN, NOW))).toBe("malformed");
    expect(reasonOf(() => verifyMiniAppInitData("garbage", BOT_TOKEN, NOW))).toBe("malformed");
  });

  it("проверка подписи идёт раньше проверки срока: протухшая подделка → bad_signature", () => {
    const forgedStale = signMiniAppInitData({
      botToken: BOT_TOKEN,
      signWithToken: "999:other",
      authDate: nowSec - 99_999,
      user: { id: 1 },
    });
    expect(reasonOf(() => verifyMiniAppInitData(forgedStale, BOT_TOKEN, NOW))).toBe(
      "bad_signature",
    );
  });
});

describe("verifyWidgetLogin", () => {
  it("принимает валидную подпись, в т.ч. без необязательных полей", () => {
    const payload = signWidgetLogin({
      botToken: BOT_TOKEN,
      authDate: nowSec - 5,
      user: { id: 42, first_name: "Анна", username: "anna" },
    });
    const result = verifyWidgetLogin(payload, BOT_TOKEN, NOW);
    expect(result.profile).toEqual({
      telegramId: 42n,
      firstName: "Анна",
      lastName: undefined,
      username: "anna",
      photoUrl: undefined,
    });
  });

  it("протухший → expired, чужой токен → bad_signature, подмена id → bad_signature", () => {
    const stale = signWidgetLogin({
      botToken: BOT_TOKEN,
      authDate: nowSec - 4000,
      user: { id: 1, first_name: "A" },
    });
    expect(reasonOf(() => verifyWidgetLogin(stale, BOT_TOKEN, NOW))).toBe("expired");

    const foreign = signWidgetLogin({
      botToken: BOT_TOKEN,
      signWithToken: "1:x",
      authDate: nowSec,
      user: { id: 1, first_name: "A" },
    });
    expect(reasonOf(() => verifyWidgetLogin(foreign, BOT_TOKEN, NOW))).toBe("bad_signature");

    const valid = signWidgetLogin({
      botToken: BOT_TOKEN,
      authDate: nowSec,
      user: { id: 1, first_name: "A" },
    });
    expect(reasonOf(() => verifyWidgetLogin({ ...valid, id: 2 }, BOT_TOKEN, NOW))).toBe(
      "bad_signature",
    );
  });
});

import { createHash, createHmac } from "node:crypto";
import { widgetDataCheckString, type WidgetLoginPayload } from "../telegram-signature";

/**
 * Генерация подписанных фикстур Telegram для тестов и smoke-проверок.
 * Алгоритмы зеркальны verifyMiniAppInitData / verifyWidgetLogin.
 */

export interface MiniAppUserFixture {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

export interface MiniAppInitDataOptions {
  user: MiniAppUserFixture;
  botToken: string;
  /** unix-секунды; по умолчанию сейчас */
  authDate?: number;
  startParam?: string;
  queryId?: string;
  /** Подписать чужим токеном, но сообщить исходный — для теста подделки */
  signWithToken?: string;
}

export function signMiniAppInitData(options: MiniAppInitDataOptions): string {
  const authDate = options.authDate ?? Math.floor(Date.now() / 1000);
  const params = new URLSearchParams();
  params.set("query_id", options.queryId ?? "AAHdF6IQAAAAAN0XohDhrOrc");
  params.set("user", JSON.stringify({ first_name: "Test", ...options.user }));
  params.set("auth_date", String(authDate));
  if (options.startParam) params.set("start_param", options.startParam);

  const pairs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort();
  const secret = createHmac("sha256", "WebAppData")
    .update(options.signWithToken ?? options.botToken)
    .digest();
  const hash = createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

export interface WidgetLoginOptions {
  user: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    photo_url?: string;
  };
  botToken: string;
  authDate?: number;
  signWithToken?: string;
}

export function signWidgetLogin(options: WidgetLoginOptions): WidgetLoginPayload {
  const fields: Omit<WidgetLoginPayload, "hash"> = {
    ...options.user,
    auth_date: options.authDate ?? Math.floor(Date.now() / 1000),
  };
  const secret = createHash("sha256")
    .update(options.signWithToken ?? options.botToken)
    .digest();
  const hash = createHmac("sha256", secret).update(widgetDataCheckString(fields)).digest("hex");
  return { ...fields, hash };
}

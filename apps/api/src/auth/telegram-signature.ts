import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { TELEGRAM_AUTH_MAX_AGE_SEC, UnauthorizedError } from "@kadr/shared";
import { z } from "zod";

/** Профиль Telegram, общий для Mini App и Login Widget */
export interface TelegramProfile {
  telegramId: bigint;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  languageCode?: string;
}

export interface VerifiedTelegramAuth {
  profile: TelegramProfile;
  /** start_param из Mini App (deep link), например ref_<code> */
  startParam?: string;
  /** unix-секунды подписи */
  authDate: number;
}

export type TelegramAuthFailure = "malformed" | "bad_signature" | "expired";

export class TelegramAuthError extends UnauthorizedError {
  constructor(public readonly reason: TelegramAuthFailure) {
    super({ reason });
    this.name = "TelegramAuthError";
  }
}

/** Сколько секунд в будущем допускаем auth_date (рассинхрон часов) */
const FUTURE_SKEW_SEC = 60;

const miniAppUserSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string().default(""),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  language_code: z.string().optional(),
});

/**
 * Проверка initData Telegram Web Apps:
 * secret = HMAC_SHA256(key = "WebAppData", msg = BOT_TOKEN),
 * hash = HMAC_SHA256(key = secret, msg = data_check_string), где data_check_string —
 * все пары key=value кроме hash, отсортированные по ключу, через \n.
 */
export function verifyMiniAppInitData(
  initData: string,
  botToken: string,
  now: Date = new Date(),
  maxAgeSec: number = TELEGRAM_AUTH_MAX_AGE_SEC,
): VerifiedTelegramAuth {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new TelegramAuthError("malformed");

  const pairs: string[] = [];
  for (const [key, value] of params) {
    if (key !== "hash") pairs.push(`${key}=${value}`);
  }
  const dataCheckString = pairs.sort().join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  if (!safeEqualHex(expected, hash)) throw new TelegramAuthError("bad_signature");

  const authDate = parseAuthDate(params.get("auth_date"));
  assertFresh(authDate, now, maxAgeSec);

  const rawUser = params.get("user");
  if (!rawUser) throw new TelegramAuthError("malformed");
  let user: z.infer<typeof miniAppUserSchema>;
  try {
    user = miniAppUserSchema.parse(JSON.parse(rawUser));
  } catch {
    throw new TelegramAuthError("malformed");
  }

  const startParam = params.get("start_param") ?? undefined;
  return {
    profile: {
      telegramId: BigInt(user.id),
      firstName: user.first_name,
      lastName: user.last_name,
      username: user.username,
      photoUrl: user.photo_url,
      languageCode: user.language_code,
    },
    startParam: startParam && startParam.length <= 64 ? startParam : undefined,
    authDate,
  };
}

export interface WidgetLoginPayload {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

/**
 * Проверка данных Telegram Login Widget:
 * secret = SHA256(BOT_TOKEN), hash = HMAC_SHA256(key = secret, msg = data_check_string).
 */
export function verifyWidgetLogin(
  payload: WidgetLoginPayload,
  botToken: string,
  now: Date = new Date(),
  maxAgeSec: number = TELEGRAM_AUTH_MAX_AGE_SEC,
): VerifiedTelegramAuth {
  const { hash, ...fields } = payload;
  if (!hash) throw new TelegramAuthError("malformed");

  const dataCheckString = widgetDataCheckString(fields);
  const secret = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  if (!safeEqualHex(expected, hash)) throw new TelegramAuthError("bad_signature");

  const authDate = parseAuthDate(String(fields.auth_date));
  assertFresh(authDate, now, maxAgeSec);

  return {
    profile: {
      telegramId: BigInt(fields.id),
      firstName: fields.first_name,
      lastName: fields.last_name,
      username: fields.username,
      photoUrl: fields.photo_url,
    },
    authDate,
  };
}

/** data_check_string для Login Widget: все непустые поля кроме hash, отсортированные. */
export function widgetDataCheckString(fields: Omit<WidgetLoginPayload, "hash">): string {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${String(v)}`)
    .sort()
    .join("\n");
}

function parseAuthDate(raw: string | null): number {
  if (!raw || !/^\d{1,12}$/.test(raw)) throw new TelegramAuthError("malformed");
  return Number.parseInt(raw, 10);
}

function assertFresh(authDate: number, now: Date, maxAgeSec: number): void {
  const nowSec = Math.floor(now.getTime() / 1000);
  if (authDate > nowSec + FUTURE_SKEW_SEC) throw new TelegramAuthError("expired");
  if (nowSec - authDate > maxAgeSec) throw new TelegramAuthError("expired");
}

function safeEqualHex(expectedHex: string, actualHex: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(actualHex)) return false;
  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(actualHex.toLowerCase(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

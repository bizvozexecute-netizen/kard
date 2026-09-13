import { z } from "zod";
import { meSchema } from "./users";

/** POST /v1/auth/telegram-mini-app */
export const telegramMiniAppAuthSchema = z.object({
  initData: z.string().min(1).max(4096),
});
export type TelegramMiniAppAuthDto = z.infer<typeof telegramMiniAppAuthSchema>;

/** POST /v1/auth/telegram-widget — поля Telegram Login Widget как есть */
export const telegramWidgetAuthSchema = z.object({
  id: z.coerce.number().int().positive(),
  first_name: z.string().max(256),
  last_name: z.string().max(256).optional(),
  username: z.string().max(64).optional(),
  photo_url: z.string().url().max(1024).optional(),
  auth_date: z.coerce.number().int().positive(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type TelegramWidgetAuthDto = z.infer<typeof telegramWidgetAuthSchema>;

/** POST /v1/auth/refresh */
export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(4096),
});
export type RefreshDto = z.infer<typeof refreshSchema>;

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Секунды жизни access-токена */
  accessExpiresIn: z.number().int().positive(),
  /** Секунды жизни refresh-токена */
  refreshExpiresIn: z.number().int().positive(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const authResponseSchema = z.object({
  tokens: authTokensSchema,
  user: meSchema,
  /** true, если пользователь только что создан */
  isNew: z.boolean(),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const ACCESS_TOKEN_TTL_SEC = 15 * 60;
export const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60;
/** Максимальный возраст auth_date в initData / widget-подписи */
export const TELEGRAM_AUTH_MAX_AGE_SEC = 3600;
/** Префикс deep-link реферала: /start ref_<code>, start_param=ref_<code> */
export const REFERRAL_START_PREFIX = "ref_";

import { z } from "zod";

/**
 * Коды ошибок API. Единственный источник для бека и фронта.
 * Текст для пользователя по коду — apps/api/src/i18n/ru.ts.
 */
export const ErrorCode = {
  INSUFFICIENT_CREDITS: "INSUFFICIENT_CREDITS",
  MODERATION_BLOCKED: "MODERATION_BLOCKED",
  PRICE_CHANGED: "PRICE_CHANGED",
  PROVIDER_TIMEOUT: "PROVIDER_TIMEOUT",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  NSFW_OUTPUT: "NSFW_OUTPUT",
  UPSTREAM_OVERLOAD: "UPSTREAM_OVERLOAD",
  NOT_FOUND: "NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  RATE_LIMITED: "RATE_LIMITED",
  /** Невалидный ввод (zod) — 400 */
  VALIDATION_ERROR: "VALIDATION_ERROR",
  /** Непредвиденная ошибка сервера — 500 */
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export const errorCodeSchema = z.nativeEnum(ErrorCode);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Формат любого ответа API с ошибкой: { error: { code, message, details } } */
export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

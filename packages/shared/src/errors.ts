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
  /** Операция недопустима в текущем состоянии (release после commit и т.п.) — 409 */
  ILLEGAL_TRANSITION: "ILLEGAL_TRANSITION",
  /** Ежедневный бонус за сегодня уже получен — 409 */
  ALREADY_CLAIMED: "ALREADY_CLAIMED",
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

/**
 * Базовый класс доменных ошибок для всех пакетов (без зависимости от Nest).
 * Глобальный фильтр API превращает его в { error: { code, message, details } }
 * с указанным HTTP-статусом; текст берётся из i18n по коду.
 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number = 400,
    public readonly details?: unknown,
  ) {
    super(code);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(details?: unknown) {
    super(ErrorCode.NOT_FOUND, 404, details);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(details?: unknown) {
    super(ErrorCode.UNAUTHORIZED, 401, details);
    this.name = "UnauthorizedError";
  }
}

export class ValidationError extends AppError {
  constructor(details?: unknown) {
    super(ErrorCode.VALIDATION_ERROR, 400, details);
    this.name = "ValidationError";
  }
}

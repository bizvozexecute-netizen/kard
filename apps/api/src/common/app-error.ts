import { HttpStatus } from "@nestjs/common";
import { type ErrorCode } from "@kadr/shared";

/**
 * Базовый класс доменных ошибок. Глобальный фильтр превращает его в
 * { error: { code, message, details } } с указанным HTTP-статусом.
 * Текст сообщения берётся из i18n по коду, сюда его передавать не нужно.
 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
  ) {
    super(code);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(details?: unknown) {
    super("NOT_FOUND", HttpStatus.NOT_FOUND, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(details?: unknown) {
    super("UNAUTHORIZED", HttpStatus.UNAUTHORIZED, details);
  }
}

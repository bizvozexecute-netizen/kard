import { type ErrorCode } from "@kadr/shared";

/**
 * Все тексты для пользователя — только отсюда (правило 4 CLAUDE.md).
 * Ключи ошибок совпадают с ErrorCode из @kadr/shared.
 */
export const ru = {
  errors: {
    INSUFFICIENT_CREDITS: "Недостаточно кредитов",
    MODERATION_BLOCKED: "Запрос не прошёл модерацию",
    PRICE_CHANGED: "Цена изменилась, обновите страницу",
    PROVIDER_TIMEOUT: "Сервис генерации не ответил вовремя, попробуйте ещё раз",
    PROVIDER_ERROR: "Ошибка сервиса генерации, попробуйте ещё раз",
    NSFW_OUTPUT: "Результат заблокирован фильтром контента",
    UPSTREAM_OVERLOAD: "Сервис перегружен, попробуйте через минуту",
    NOT_FOUND: "Не найдено",
    UNAUTHORIZED: "Требуется авторизация",
    RATE_LIMITED: "Слишком много запросов, попробуйте позже",
    VALIDATION_ERROR: "Некорректные данные запроса",
    INTERNAL_ERROR: "Внутренняя ошибка, мы уже разбираемся",
    ILLEGAL_TRANSITION: "Операция уже выполнена или недопустима в текущем состоянии",
  } satisfies Record<ErrorCode, string>,
} as const;

export function errorMessage(code: ErrorCode): string {
  return ru.errors[code];
}

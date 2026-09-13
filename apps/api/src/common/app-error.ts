/**
 * Доменные ошибки живут в @kadr/shared, чтобы их могли бросать пакеты без Nest
 * (например @kadr/ledger). Здесь — реэкспорт для удобства импорта внутри api.
 */
export { AppError, NotFoundError, UnauthorizedError, ValidationError } from "@kadr/shared";

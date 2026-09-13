import { AppError, ErrorCode } from "@kadr/shared";

/** Недостаточно кредитов: missing — сколько не хватает до запрошенной суммы. */
export class InsufficientCreditsError extends AppError {
  constructor(public readonly missing: bigint) {
    super(ErrorCode.INSUFFICIENT_CREDITS, 402, { missing: missing.toString() });
    this.name = "InsufficientCreditsError";
  }
}

/** Операция недопустима в текущем состоянии: release после commit, commit после release. */
export class IllegalTransitionError extends AppError {
  constructor(details: { refType: string; refId: string; reason: string }) {
    super(ErrorCode.ILLEGAL_TRANSITION, 409, details);
    this.name = "IllegalTransitionError";
  }
}

/** Попытка commit/release больше, чем зарезервировано. */
export class InsufficientReservedError extends AppError {
  constructor(
    public readonly reserved: bigint,
    requested: bigint,
  ) {
    super(ErrorCode.ILLEGAL_TRANSITION, 409, {
      reason: "insufficient_reserved",
      reserved: reserved.toString(),
      requested: requested.toString(),
    });
    this.name = "InsufficientReservedError";
  }
}

/** У пользователя нет кредитного счёта. */
export class AccountNotFoundError extends AppError {
  constructor(userId: string) {
    super(ErrorCode.NOT_FOUND, 404, { entity: "credit_account", userId });
    this.name = "AccountNotFoundError";
  }
}

/** Некорректный аргумент (сумма ≤ 0, пустой ключ). Проверяется до транзакции. */
export class LedgerArgumentError extends AppError {
  constructor(message: string) {
    super(ErrorCode.VALIDATION_ERROR, 400, { reason: message });
    this.name = "LedgerArgumentError";
  }
}

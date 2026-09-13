import { AppError, type ErrorCode, type GenOutput, type GenPollStatus } from "@kadr/shared";

/** Запрос на генерацию (интерфейс из ТЗ §7). */
export interface GenSubmitRequest {
  model: string;
  prompt: string;
  negative?: string;
  image?: Buffer;
  params: Record<string, unknown>;
}

export interface GenSubmitResult {
  jobId: string;
}

export interface GenPollResult {
  status: GenPollStatus;
  /** 0..100, если провайдер отдаёт прогресс */
  progress?: number;
  outputs?: GenOutput[];
  costUsd?: number;
  /** Код ошибки при status='failed' */
  errorCode?: ErrorCode;
}

/** Адаптер провайдера генерации. Все внешние HTTP — только внутри реализаций (правило 3). */
export interface GenProvider {
  submit(req: GenSubmitRequest): Promise<GenSubmitResult>;
  poll(jobId: string): Promise<GenPollResult>;
  cancel?(jobId: string): Promise<void>;
}

export type ProviderErrorCode =
  "PROVIDER_ERROR" | "PROVIDER_TIMEOUT" | "UPSTREAM_OVERLOAD" | "NSFW_OUTPUT";

/** Ошибка провайдера с нашим кодом; фильтр api превратит её в единый формат. */
export class ProviderError extends AppError {
  constructor(
    code: ProviderErrorCode,
    public readonly provider: string,
    public readonly model: string,
    reason: string,
  ) {
    super(code, 502, { provider, model, reason });
    this.name = "ProviderError";
  }
}

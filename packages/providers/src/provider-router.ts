import type { ProviderChain } from "@kadr/shared";
import type { RedisCircuitBreaker } from "./circuit-breaker";
import {
  type GenPollResult,
  type GenProvider,
  type GenSubmitRequest,
  ProviderError,
} from "./types";

export interface RouterLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface RoutedSubmitResult {
  provider: string;
  model: string;
  jobId: string;
  /** Сколько звеньев цепочки было испробовано (для метрик/логов) */
  attemptedLinks: number;
}

/**
 * Идёт по providerChain операции: пропускает открытые breaker'ом и незарегистрированные
 * звенья, при ошибке submit фиксирует сбой и пробует следующее звено (ТЗ §7).
 */
export class ProviderRouter {
  constructor(
    private readonly providers: Record<string, GenProvider>,
    private readonly breaker: RedisCircuitBreaker,
    private readonly logger: RouterLogger,
  ) {}

  async submit(
    chain: ProviderChain,
    req: Omit<GenSubmitRequest, "model">,
  ): Promise<RoutedSubmitResult> {
    let lastError: unknown;
    let attempted = 0;

    for (const link of chain) {
      const provider = this.providers[link.provider];
      if (!provider) {
        this.logger.warn({ link }, "provider not registered, skipping link");
        continue;
      }
      if (await this.breaker.isOpen(link.provider, link.model)) {
        this.logger.warn({ link }, "circuit open, skipping link");
        continue;
      }

      attempted += 1;
      try {
        const { jobId } = await provider.submit({
          ...req,
          model: link.model,
          params: { ...req.params, ...(link.params ?? {}) },
        });
        await this.breaker.recordSuccess(link.provider, link.model);
        this.logger.info(
          { provider: link.provider, model: link.model, jobId, attempted },
          "provider submit ok",
        );
        return { provider: link.provider, model: link.model, jobId, attemptedLinks: attempted };
      } catch (err) {
        lastError = err;
        await this.breaker.recordFailure(link.provider, link.model);
        this.logger.warn(
          { provider: link.provider, model: link.model, err: String(err) },
          "provider submit failed, trying next link",
        );
      }
    }

    if (lastError) throw lastError;
    throw new ProviderError(
      "PROVIDER_ERROR",
      chain[0]?.provider ?? "?",
      chain[0]?.model ?? "?",
      "provider chain exhausted: all links skipped",
    );
  }

  async poll(providerName: string, jobId: string): Promise<GenPollResult> {
    const provider = this.require(providerName, jobId);
    const result = await provider.poll(jobId);
    // Инфраструктурные провалы учитываются в здоровье звена; NSFW — контент, не здоровье
    if (result.status === "failed" && result.errorCode && result.errorCode !== "NSFW_OUTPUT") {
      await this.breaker.recordFailure(providerName, modelOf(jobId));
    }
    return result;
  }

  async cancel(providerName: string, jobId: string): Promise<void> {
    const provider = this.require(providerName, jobId);
    await provider.cancel?.(jobId);
  }

  private require(providerName: string, jobId: string): GenProvider {
    const provider = this.providers[providerName];
    if (!provider) {
      throw new ProviderError("PROVIDER_ERROR", providerName, modelOf(jobId), "unknown provider");
    }
    return provider;
  }
}

function modelOf(jobId: string): string {
  const idx = jobId.lastIndexOf("::");
  return idx > 0 ? jobId.slice(0, idx) : "?";
}

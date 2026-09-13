import { CB_ERROR_THRESHOLD, CB_OPEN_SEC, CB_WINDOW_SEC } from "@kadr/shared";

/** Минимальное подмножество Redis (совместимо с ioredis; в тестах — Map-фейк). */
export interface BreakerStore {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  exists(key: string): Promise<number>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  del(key: string): Promise<number>;
}

export interface BreakerOptions {
  threshold?: number;
  windowSec?: number;
  openSec?: number;
}

export type BreakerStateListener = (event: {
  provider: string;
  model: string;
  state: "open";
  failures: number;
}) => void;

const errKey = (p: string, m: string) => `cb:err:${p}:${m}`;
const openKey = (p: string, m: string) => `cb:open:${p}:${m}`;

/**
 * Circuit breaker звена цепочки провайдеров (ТЗ §7): threshold ошибок за windowSec
 * → звено пропускается openSec. Состояние в Redis — общее для всех воркеров.
 */
export class RedisCircuitBreaker {
  private readonly threshold: number;
  private readonly windowSec: number;
  private readonly openSec: number;

  constructor(
    private readonly store: BreakerStore,
    options: BreakerOptions = {},
    private readonly onOpen?: BreakerStateListener,
  ) {
    this.threshold = options.threshold ?? CB_ERROR_THRESHOLD;
    this.windowSec = options.windowSec ?? CB_WINDOW_SEC;
    this.openSec = options.openSec ?? CB_OPEN_SEC;
  }

  async isOpen(provider: string, model: string): Promise<boolean> {
    return (await this.store.exists(openKey(provider, model))) > 0;
  }

  async recordFailure(provider: string, model: string): Promise<void> {
    const key = errKey(provider, model);
    const failures = await this.store.incr(key);
    if (failures === 1) await this.store.expire(key, this.windowSec);
    if (failures >= this.threshold) {
      await this.store.set(openKey(provider, model), "1", "EX", this.openSec);
      await this.store.del(key);
      this.onOpen?.({ provider, model, state: "open", failures });
    }
  }

  async recordSuccess(provider: string, model: string): Promise<void> {
    await this.store.del(errKey(provider, model));
  }
}

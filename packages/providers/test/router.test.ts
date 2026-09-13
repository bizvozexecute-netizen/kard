import { describe, expect, it, vi } from "vitest";
import { type GenProvider, ProviderError, ProviderRouter, RedisCircuitBreaker } from "../src";
import { FakeStore } from "./fake-store";

const logger = { info: vi.fn(), warn: vi.fn() };

function okProvider(jobId = "m::ok"): GenProvider {
  return { submit: vi.fn().mockResolvedValue({ jobId }), poll: vi.fn() };
}

function failingProvider(
  code: "PROVIDER_ERROR" | "UPSTREAM_OVERLOAD" = "PROVIDER_ERROR",
): GenProvider {
  return {
    submit: vi.fn().mockRejectedValue(new ProviderError(code, "fal", "m1", "boom")),
    poll: vi.fn(),
  };
}

const chain = [
  { provider: "fal", model: "m1" },
  { provider: "fal", model: "m2" },
];
const req = { prompt: "cat", params: {} };

describe("RedisCircuitBreaker", () => {
  it("открывается после threshold ошибок и уведомляет; успех сбрасывает счётчик", async () => {
    const store = new FakeStore();
    const onOpen = vi.fn();
    const breaker = new RedisCircuitBreaker(
      store,
      { threshold: 3, windowSec: 600, openSec: 600 },
      onOpen,
    );

    await breaker.recordFailure("fal", "m1");
    // окно счётчика выставлено при первом инкременте
    expect(store.ttl.get("cb:err:fal:m1")).toBe(600);
    await breaker.recordFailure("fal", "m1");
    expect(await breaker.isOpen("fal", "m1")).toBe(false);
    await breaker.recordFailure("fal", "m1");
    expect(await breaker.isOpen("fal", "m1")).toBe(true);
    expect(onOpen).toHaveBeenCalledWith({
      provider: "fal",
      model: "m1",
      state: "open",
      failures: 3,
    });
    expect(store.ttl.get("cb:open:fal:m1")).toBe(600);
    // счётчик сброшен при открытии
    expect(store.map.has("cb:err:fal:m1")).toBe(false);

    // другой model не затронут
    expect(await breaker.isOpen("fal", "m2")).toBe(false);

    const store2 = new FakeStore();
    const breaker2 = new RedisCircuitBreaker(store2, { threshold: 3 });
    await breaker2.recordFailure("fal", "x");
    await breaker2.recordFailure("fal", "x");
    await breaker2.recordSuccess("fal", "x");
    await breaker2.recordFailure("fal", "x");
    expect(await breaker2.isOpen("fal", "x")).toBe(false);
  });
});

describe("ProviderRouter.submit", () => {
  it("первое звено упало → уходит на второе, ошибка первого учтена в breaker", async () => {
    const store = new FakeStore();
    const breaker = new RedisCircuitBreaker(store, { threshold: 5 });
    const fal = {
      submit: vi
        .fn()
        .mockRejectedValueOnce(new ProviderError("PROVIDER_ERROR", "fal", "m1", "boom"))
        .mockResolvedValueOnce({ jobId: "m2::r" }),
      poll: vi.fn(),
    };
    const router = new ProviderRouter({ fal }, breaker, logger);

    const result = await router.submit(chain, req);
    expect(result).toMatchObject({
      provider: "fal",
      model: "m2",
      jobId: "m2::r",
      attemptedLinks: 2,
    });
    expect(store.map.get("cb:err:fal:m1")).toBe("1");
    expect(store.map.has("cb:err:fal:m2")).toBe(false); // recordSuccess удалил
  });

  it("открытое звено пропускается без попытки", async () => {
    const store = new FakeStore();
    const breaker = new RedisCircuitBreaker(store);
    await store.set("cb:open:fal:m1", "1", "EX", 600);
    const provider = okProvider("m2::r");
    const router = new ProviderRouter({ fal: provider }, breaker, logger);

    const result = await router.submit(chain, req);
    expect(result.model).toBe("m2");
    expect(provider.submit).toHaveBeenCalledTimes(1);
    expect(provider.submit).toHaveBeenCalledWith(expect.objectContaining({ model: "m2" }));
  });

  it("params звена мержатся поверх params запроса", async () => {
    const provider = okProvider();
    const router = new ProviderRouter(
      { fal: provider },
      new RedisCircuitBreaker(new FakeStore()),
      logger,
    );
    await router.submit([{ provider: "fal", model: "m1", params: { steps: 30 } }], {
      prompt: "cat",
      params: { seed: 1, steps: 4 },
    });
    expect(provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({ params: { seed: 1, steps: 30 } }),
    );
  });

  it("все звенья упали → последняя ошибка; все пропущены → ProviderError chain exhausted", async () => {
    const breaker = new RedisCircuitBreaker(new FakeStore());
    const router = new ProviderRouter(
      { fal: failingProvider("UPSTREAM_OVERLOAD") },
      breaker,
      logger,
    );
    const err = await router.submit(chain, req).catch((e: unknown) => e);
    expect((err as ProviderError).code).toBe("UPSTREAM_OVERLOAD");

    const emptyRouter = new ProviderRouter({}, breaker, logger);
    const err2 = await emptyRouter.submit(chain, req).catch((e: unknown) => e);
    expect((err2 as ProviderError).code).toBe("PROVIDER_ERROR");
    expect((err2 as ProviderError).details).toMatchObject({
      reason: expect.stringContaining("exhausted"),
    });
  });
});

describe("ProviderRouter.poll", () => {
  it("failed c инфраструктурным кодом инкрементит breaker; NSFW — нет", async () => {
    const store = new FakeStore();
    const breaker = new RedisCircuitBreaker(store);
    const provider: GenProvider = {
      submit: vi.fn(),
      poll: vi
        .fn()
        .mockResolvedValueOnce({ status: "failed", errorCode: "PROVIDER_TIMEOUT" })
        .mockResolvedValueOnce({ status: "failed", errorCode: "NSFW_OUTPUT" })
        .mockResolvedValueOnce({ status: "succeeded", outputs: [] }),
    };
    const router = new ProviderRouter({ fal: provider }, breaker, logger);

    await router.poll("fal", "m1::r");
    expect(store.map.get("cb:err:fal:m1")).toBe("1");
    await router.poll("fal", "m1::r");
    expect(store.map.get("cb:err:fal:m1")).toBe("1"); // NSFW не считается
    await router.poll("fal", "m1::r");

    await expect(router.poll("ghost", "m::r")).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
});

import { describe, expect, it, vi } from "vitest";
import { extractOutputs, FalProvider, type FalQueueClient, ProviderError } from "../src";

function makeClient(overrides: Partial<FalQueueClient> = {}): FalQueueClient {
  return {
    submit: vi.fn().mockResolvedValue({ request_id: "req-1" }),
    status: vi.fn().mockResolvedValue({ status: "COMPLETED" }),
    result: vi.fn().mockResolvedValue({ data: { images: [{ url: "https://f.al/a.png" }] } }),
    cancel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const req = { model: "fal-ai/flux/schnell", prompt: "cat", params: {} };

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

describe("FalProvider.submit", () => {
  it("возвращает jobId с закодированной моделью и передаёт negative_prompt", async () => {
    const client = makeClient();
    const provider = new FalProvider({ apiKey: "k", client });
    const { jobId } = await provider.submit({ ...req, negative: "blur", params: { seed: 42 } });
    expect(jobId).toBe("fal-ai/flux/schnell::req-1");
    expect(client.submit).toHaveBeenCalledWith(
      "fal-ai/flux/schnell",
      expect.objectContaining({
        input: { prompt: "cat", seed: 42, negative_prompt: "blur" },
        abortSignal: expect.any(AbortSignal),
      }),
    );
  });

  it("маппит ошибки: 429 → UPSTREAM_OVERLOAD, 5xx → PROVIDER_ERROR, nsfw-текст → NSFW_OUTPUT", async () => {
    const cases: Array<[Error, string]> = [
      [httpError(429, "Too Many Requests"), "UPSTREAM_OVERLOAD"],
      [httpError(500, "Internal"), "PROVIDER_ERROR"],
      [httpError(422, "flagged by content policy checks"), "NSFW_OUTPUT"],
    ];
    for (const [error, code] of cases) {
      const provider = new FalProvider({
        apiKey: "k",
        client: makeClient({ submit: vi.fn().mockRejectedValue(error) }),
      });
      const err = await provider.submit(req).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).code).toBe(code);
      expect((err as ProviderError).details).toMatchObject({ provider: "fal", model: req.model });
    }
  });

  it("submit дольше таймаута → PROVIDER_TIMEOUT", async () => {
    const never: FalQueueClient["submit"] = (_e, options) =>
      new Promise((_resolve, reject) => {
        options.abortSignal?.addEventListener("abort", () =>
          reject(
            Object.assign(new Error("The operation was aborted due to timeout"), {
              name: "TimeoutError",
            }),
          ),
        );
      });
    const provider = new FalProvider({
      apiKey: "k",
      submitTimeoutMs: 30,
      client: makeClient({ submit: never }),
    });
    const err = await provider.submit(req).catch((e: unknown) => e);
    expect((err as ProviderError).code).toBe("PROVIDER_TIMEOUT");
  });
});

describe("FalProvider.poll", () => {
  it("IN_QUEUE/IN_PROGRESS → running; COMPLETED → succeeded с outputs", async () => {
    const client = makeClient({
      status: vi
        .fn()
        .mockResolvedValueOnce({ status: "IN_QUEUE", queue_position: 3 })
        .mockResolvedValueOnce({ status: "IN_PROGRESS" })
        .mockResolvedValueOnce({ status: "COMPLETED" }),
    });
    const provider = new FalProvider({ apiKey: "k", client });
    const jobId = "fal-ai/flux/schnell::req-1";

    expect(await provider.poll(jobId)).toEqual({ status: "running" });
    expect(await provider.poll(jobId)).toEqual({ status: "running" });
    const done = await provider.poll(jobId);
    expect(done.status).toBe("succeeded");
    expect(done.outputs).toEqual([{ url: "https://f.al/a.png", mime: "image/png" }]);
    expect(client.status).toHaveBeenCalledWith("fal-ai/flux/schnell", {
      requestId: "req-1",
      logs: false,
    });
  });

  it("HTTP 422 на status (job провален) → failed с кодом, без throw", async () => {
    const client = makeClient({
      status: vi.fn().mockRejectedValue(httpError(422, "generation failed: nsfw content detected")),
    });
    const provider = new FalProvider({ apiKey: "k", client });
    const result = await provider.poll("m::r");
    expect(result).toEqual({ status: "failed", errorCode: "NSFW_OUTPUT" });
  });

  it("инфраструктурная ошибка status → throw ProviderError", async () => {
    const client = makeClient({ status: vi.fn().mockRejectedValue(httpError(503, "unavailable")) });
    const provider = new FalProvider({ apiKey: "k", client });
    await expect(provider.poll("m::r")).rejects.toBeInstanceOf(ProviderError);
  });

  it("битый jobId → PROVIDER_ERROR", async () => {
    const provider = new FalProvider({ apiKey: "k", client: makeClient() });
    await expect(provider.poll("no-separator")).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
});

describe("extractOutputs", () => {
  it("video/audio/fallback-url и mime по расширению", () => {
    expect(extractOutputs({ video: { url: "https://x/v.mp4" } })).toEqual([
      { url: "https://x/v.mp4", mime: "video/mp4" },
    ]);
    expect(
      extractOutputs({ audio: { url: "https://x/a.mp3", content_type: "audio/mp3" } }),
    ).toEqual([{ url: "https://x/a.mp3", mime: "audio/mp3" }]);
    expect(extractOutputs({ nested: { file: { url: "https://x/out.webp" } } })).toEqual([
      { url: "https://x/out.webp", mime: "image/webp" },
    ]);
    expect(extractOutputs({})).toEqual([]);
    expect(extractOutputs(null)).toEqual([]);
  });
});

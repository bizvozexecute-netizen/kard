import { describe, expect, it, vi } from "vitest";
import { EnhancerService, GeminiClient } from "../src";
import type { LlmJsonClient, TemplateSource } from "../src/types";

const logger = { warn: vi.fn() };

const templates: TemplateSource = { getActiveBody: vi.fn().mockResolvedValue("SYSTEM PROMPT v1") };

function llmReturning(raw: string): LlmJsonClient {
  return { generateJson: vi.fn().mockResolvedValue(raw) };
}

describe("EnhancerService.enhance", () => {
  it("валидный JSON → результат с нормализацией", async () => {
    const llm = llmReturning(
      JSON.stringify({ prompt_en: "  A ginger cat ", negative_en: " blur ", category: "Animals" }),
    );
    const service = new EnhancerService(llm, templates, logger);
    const result = await service.enhance("рыжий кот", "image");
    expect(result).toEqual({ promptEn: "A ginger cat", negativeEn: "blur", category: "animals" });
    expect(llm.generateJson).toHaveBeenCalledWith(
      "SYSTEM PROMPT v1",
      "Media type: image\nUser request (Russian): рыжий кот",
      { timeoutMs: undefined },
    );
  });

  it("битый JSON и JSON без prompt_en → null", async () => {
    const s1 = new EnhancerService(llmReturning("{not json"), templates, logger);
    expect(await s1.enhance("кот", "image")).toBeNull();

    const s2 = new EnhancerService(
      llmReturning(JSON.stringify({ negative_en: "x" })),
      templates,
      logger,
    );
    expect(await s2.enhance("кот", "image")).toBeNull();
  });

  it("ошибка LLM → null; отсутствие шаблона → null без вызова LLM", async () => {
    const failing: LlmJsonClient = {
      generateJson: vi.fn().mockRejectedValue(new Error("timeout")),
    };
    expect(
      await new EnhancerService(failing, templates, logger).enhance("кот", "video"),
    ).toBeNull();

    const noTemplate: TemplateSource = { getActiveBody: vi.fn().mockResolvedValue(null) };
    const llm = llmReturning("{}");
    expect(await new EnhancerService(llm, noTemplate, logger).enhance("кот", "image")).toBeNull();
    expect(llm.generateJson).not.toHaveBeenCalled();
  });
});

describe("GeminiClient", () => {
  const okResponse = (text: string) =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
      status: 200,
    });

  it("возвращает текст первой удачной попытки", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse('{"prompt_en":"x"}'));
    const client = new GeminiClient({ apiKey: "k", fetchImpl });
    expect(await client.generateJson("sys", "user")).toBe('{"prompt_en":"x"}');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("/models/gemini-2.5-flash:generateContent");
    expect((init as RequestInit).headers).toMatchObject({ "x-goog-api-key": "k" });
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.systemInstruction.parts[0].text).toBe("sys");
  });

  it("первая попытка упала → ретрай, вторая ок (всего 2 вызова)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("overloaded", { status: 503 }))
      .mockResolvedValueOnce(okResponse("ok-json"));
    const client = new GeminiClient({ apiKey: "k", fetchImpl });
    expect(await client.generateJson("s", "u")).toBe("ok-json");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("обе попытки упали → бросает последнюю ошибку (не больше 2 вызовов)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("bad key", { status: 400 }));
    const client = new GeminiClient({ apiKey: "k", fetchImpl });
    await expect(client.generateJson("s", "u")).rejects.toThrow(/Gemini HTTP 400/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("таймаут попытки → abort сигналом, ретрай, затем ошибка", async () => {
    const fetchImpl = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })),
          );
        }),
    );
    const client = new GeminiClient({
      apiKey: "k",
      timeoutMs: 30,
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(client.generateJson("s", "u")).rejects.toMatchObject({ name: "TimeoutError" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("пустой ответ без candidates → ошибка", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const client = new GeminiClient({ apiKey: "k", fetchImpl, maxAttempts: 1 });
    await expect(client.generateJson("s", "u")).rejects.toThrow(/empty response/);
  });
});

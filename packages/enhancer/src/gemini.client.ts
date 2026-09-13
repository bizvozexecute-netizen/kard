import type { LlmJsonClient, LlmJsonOptions } from "./types";

export interface GeminiClientOptions {
  apiKey: string;
  model?: string;
  /** Таймаут одной попытки; ТЗ §7 — 3 с */
  timeoutMs?: number;
  /** 1 ретрай по ТЗ → всего 2 попытки */
  maxAttempts?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Адаптер Gemini (JSON-mode). Единственное место HTTP-вызовов к LLM (правило 3):
 * явный таймаут на попытку и один ретрай; ответ — строка JSON от модели.
 */
export class GeminiClient implements LlmJsonClient {
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GeminiClientOptions) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? 2;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateJson(system: string, user: string, opts: LlmJsonOptions = {}): Promise<string> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.attempt(system, user, opts.timeoutMs ?? this.timeoutMs);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  private async attempt(system: string, user: string, timeoutMs: number): Promise<string> {
    const url = `${this.baseUrl}/models/${this.model}:generateContent`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.options.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              prompt_en: { type: "STRING" },
              negative_en: { type: "STRING" },
              category: { type: "STRING" },
            },
            required: ["prompt_en", "negative_en", "category"],
          },
          temperature: 0.7,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const text = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
      throw new Error(`Gemini HTTP ${res.status}: ${text}`);
    }

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini: empty response");
    return text;
  }
}

import { createFalClient } from "@fal-ai/client";
import type { ErrorCode } from "@kadr/shared";
import {
  type GenPollResult,
  type GenProvider,
  type GenSubmitRequest,
  type GenSubmitResult,
  ProviderError,
} from "./types";

/** Подмножество queue-API @fal-ai/client, которое использует адаптер (подменяется в тестах). */
export interface FalQueueClient {
  submit(
    endpoint: string,
    options: { input: Record<string, unknown>; abortSignal?: AbortSignal },
  ): Promise<{ request_id: string }>;
  status(
    endpoint: string,
    options: { requestId: string; logs?: boolean },
  ): Promise<{ status: string; queue_position?: number }>;
  result(endpoint: string, options: { requestId: string }): Promise<{ data: unknown }>;
  cancel(endpoint: string, options: { requestId: string }): Promise<void>;
}

export interface FalProviderOptions {
  apiKey: string;
  /** Таймаут submit по ТЗ — 15 с */
  submitTimeoutMs?: number;
  /** Инъекция клиента для тестов */
  client?: FalQueueClient;
}

const PROVIDER = "fal";
const JOB_ID_SEPARATOR = "::";

/**
 * Адаптер fal.ai через queue API (submit + status + result, вебхуки не используем в v1).
 * jobId кодирует endpoint: `<model>::<request_id>` — status/result требуют оба.
 */
export class FalProvider implements GenProvider {
  private readonly client: FalQueueClient;
  private readonly submitTimeoutMs: number;

  constructor(options: FalProviderOptions) {
    this.submitTimeoutMs = options.submitTimeoutMs ?? 15_000;
    this.client = options.client ?? realFalQueueClient(options.apiKey);
  }

  async submit(req: GenSubmitRequest): Promise<GenSubmitResult> {
    const input: Record<string, unknown> = { prompt: req.prompt, ...req.params };
    if (req.negative) input.negative_prompt = req.negative;

    try {
      const { request_id } = await this.client.submit(req.model, {
        input,
        abortSignal: AbortSignal.timeout(this.submitTimeoutMs),
      });
      return { jobId: `${req.model}${JOB_ID_SEPARATOR}${request_id}` };
    } catch (err) {
      throw this.mapError(err, req.model);
    }
  }

  async poll(jobId: string): Promise<GenPollResult> {
    const { model, requestId } = splitJobId(jobId);
    let status: { status: string; queue_position?: number };
    try {
      status = await this.client.status(model, { requestId, logs: false });
    } catch (err) {
      // Провайдер сам сообщает о провале job'а телом ошибки статуса
      const mapped = this.mapError(err, model);
      if (isJobFailure(err)) return { status: "failed", errorCode: mapped.code as ErrorCode };
      throw mapped;
    }

    if (status.status === "IN_QUEUE" || status.status === "IN_PROGRESS") {
      return { status: "running" };
    }
    if (status.status !== "COMPLETED") {
      return { status: "failed", errorCode: "PROVIDER_ERROR" };
    }

    try {
      const { data } = await this.client.result(model, { requestId });
      return { status: "succeeded", outputs: extractOutputs(data), costUsd: extractCostUsd(data) };
    } catch (err) {
      throw this.mapError(err, model);
    }
  }

  async cancel(jobId: string): Promise<void> {
    const { model, requestId } = splitJobId(jobId);
    try {
      await this.client.cancel(model, { requestId });
    } catch {
      // отмена — best effort: job мог уже завершиться
    }
  }

  private mapError(err: unknown, model: string): ProviderError {
    if (err instanceof ProviderError) return err;
    const reason = describe(err);
    if (isTimeout(err)) return new ProviderError("PROVIDER_TIMEOUT", PROVIDER, model, reason);
    if (/nsfw|content policy|safety|content_policy/i.test(reason)) {
      return new ProviderError("NSFW_OUTPUT", PROVIDER, model, reason);
    }
    const status = httpStatus(err);
    if (status === 429) return new ProviderError("UPSTREAM_OVERLOAD", PROVIDER, model, reason);
    return new ProviderError("PROVIDER_ERROR", PROVIDER, model, reason);
  }
}

function realFalQueueClient(apiKey: string): FalQueueClient {
  const fal = createFalClient({ credentials: apiKey });
  return {
    submit: (endpoint, options) => fal.queue.submit(endpoint, options),
    status: (endpoint, options) => fal.queue.status(endpoint, options),
    result: (endpoint, options) => fal.queue.result(endpoint, options),
    cancel: async (endpoint, options) => {
      await fal.queue.cancel(endpoint, options);
    },
  };
}

function splitJobId(jobId: string): { model: string; requestId: string } {
  const idx = jobId.lastIndexOf(JOB_ID_SEPARATOR);
  if (idx <= 0)
    throw new ProviderError("PROVIDER_ERROR", PROVIDER, "?", `malformed jobId: ${jobId}`);
  return { model: jobId.slice(0, idx), requestId: jobId.slice(idx + JOB_ID_SEPARATOR.length) };
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** outputs из ответа fal: images[] | video | audio | первый url в объекте. */
export function extractOutputs(data: unknown): Array<{ url: string; mime: string }> {
  if (!isObject(data)) return [];
  const outputs: Array<{ url: string; mime: string }> = [];

  const push = (file: unknown, fallbackMime: string) => {
    if (isObject(file) && typeof file.url === "string") {
      const mime =
        typeof file.content_type === "string"
          ? file.content_type
          : mimeFromUrl(file.url, fallbackMime);
      outputs.push({ url: file.url, mime });
    }
  };

  if (Array.isArray(data.images)) for (const img of data.images) push(img, "image/png");
  push(data.video, "video/mp4");
  push(data.audio, "audio/mpeg");
  if (Array.isArray(data.audios)) for (const a of data.audios) push(a, "audio/mpeg");

  if (outputs.length === 0) {
    const url = findFirstUrl(data);
    if (url) outputs.push({ url, mime: mimeFromUrl(url, "application/octet-stream") });
  }
  return outputs;
}

function extractCostUsd(data: unknown): number | undefined {
  if (!isObject(data)) return undefined;
  for (const key of ["cost_usd", "costUsd", "price_usd", "cost"]) {
    const v = data[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

function findFirstUrl(value: unknown, depth = 0): string | undefined {
  if (depth > 4) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstUrl(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (isObject(value)) {
    if (typeof value.url === "string") return value.url;
    for (const v of Object.values(value)) {
      const found = findFirstUrl(v, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
};

function mimeFromUrl(url: string, fallback: string): string {
  try {
    const ext = new URL(url).pathname.split(".").pop()?.toLowerCase() ?? "";
    return MIME_BY_EXT[ext] ?? fallback;
  } catch {
    return fallback;
  }
}

function isTimeout(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "TimeoutError" || err.name === "AbortError" || /timed? ?out/i.test(err.message))
  );
}

function httpStatus(err: unknown): number | undefined {
  if (isObject(err)) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

/** Ошибка статуса, означающая провал самого job'а (а не инфраструктуры): fal отдаёт 422. */
function isJobFailure(err: unknown): boolean {
  return httpStatus(err) === 422;
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    const body = (err as Error & { body?: unknown }).body;
    const bodyText = body ? ` ${safeJson(body)}` : "";
    return `${err.name}: ${err.message}${bodyText}`.slice(0, 500);
  }
  return String(err).slice(0, 500);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

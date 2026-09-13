/**
 * Kadr — spike для fal.ai (сессия 0).
 *
 * Автономный скрипт: прогоняет промпт через выбранную модель fal.ai N раз,
 * опционально обогащая промпт через Gemini Flash, и пишет результаты в
 * results.csv + скачивает файлы в out/.
 *
 * Запуск: pnpm run run -- --model flux/schnell --prompt "кот в очках" --enhance=true --n 3
 */

import { fal } from "@fal-ai/client";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";

// ---------------------------------------------------------------------------
// Константы и пути
// ---------------------------------------------------------------------------

const SPIKE_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(SPIKE_DIR, "out");
const RESULTS_CSV = path.join(SPIKE_DIR, "results.csv");
const CSV_HEADER = "timestamp,model,enhance,latency_ms,status,price,url\n";

const GEMINI_TIMEOUT_MS = 5_000;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

// ---------------------------------------------------------------------------
// Модели
// ---------------------------------------------------------------------------

type ModelKey = "flux/schnell" | "flux/dev" | "kling-video" | "veo";
type MediaKind = "image" | "video";

interface ModelSpec {
  /** Ключ env для переопределения endpoint: FAL_ENDPOINT_<envKey> */
  envKey: string;
  defaultEndpoint: string;
  kind: MediaKind;
  buildInput: (prompt: string, negative?: string) => Record<string, unknown>;
}

const MODELS: Record<ModelKey, ModelSpec> = {
  "flux/schnell": {
    envKey: "FLUX_SCHNELL",
    defaultEndpoint: "fal-ai/flux/schnell",
    kind: "image",
    buildInput: (prompt) => ({
      prompt,
      image_size: "landscape_4_3",
      num_images: 1,
    }),
  },
  "flux/dev": {
    envKey: "FLUX_DEV",
    defaultEndpoint: "fal-ai/flux/dev",
    kind: "image",
    buildInput: (prompt) => ({
      prompt,
      image_size: "landscape_4_3",
      num_images: 1,
    }),
  },
  "kling-video": {
    envKey: "KLING_VIDEO",
    defaultEndpoint: "fal-ai/kling-video/v2.1/standard/text-to-video",
    kind: "video",
    buildInput: (prompt, negative) => ({
      prompt,
      duration: "5",
      aspect_ratio: "16:9",
      ...(negative ? { negative_prompt: negative } : {}),
    }),
  },
  veo: {
    envKey: "VEO",
    defaultEndpoint: "fal-ai/veo3",
    kind: "video",
    buildInput: (prompt, negative) => ({
      prompt,
      duration: "8s",
      aspect_ratio: "16:9",
      generate_audio: true,
      ...(negative ? { negative_prompt: negative } : {}),
    }),
  },
};

const MODEL_KEYS = Object.keys(MODELS) as ModelKey[];

function isModelKey(value: string): value is ModelKey {
  return (MODEL_KEYS as string[]).includes(value);
}

function resolveEndpoint(spec: ModelSpec): string {
  return process.env[`FAL_ENDPOINT_${spec.envKey}`] ?? spec.defaultEndpoint;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
  model: ModelKey;
  prompt: string;
  enhance: boolean;
  n: number;
}

function printUsage(): void {
  console.log(`Usage: pnpm run run -- --model <model> --prompt "<текст>" [--enhance=true|false] [--n <число>]

Options:
  --model    ${MODEL_KEYS.join(" | ")}   (обязательно)
  --prompt   текст запроса на русском                          (обязательно)
  --enhance  обогащать промпт через Gemini Flash, true|false   (по умолчанию false)
  --n        число прогонов                                     (по умолчанию 1)
  --help     эта справка

Env:
  FAL_KEY               ключ fal.ai (обязательно)
  GEMINI_KEY            ключ Gemini (нужен при --enhance=true)
  GEMINI_MODEL          модель Gemini (по умолчанию ${GEMINI_MODEL})
  FAL_ENDPOINT_<MODEL>  переопределить endpoint fal: FLUX_SCHNELL, FLUX_DEV, KLING_VIDEO, VEO`);
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(v)) return true;
  if (["false", "0", "no", "n", "off"].includes(v)) return false;
  throw new Error(`--enhance: ожидается true|false, получено "${raw}"`);
}

function parseCli(argv: string[]): CliOptions | null {
  // pnpm 10 пробрасывает разделитель "--" в скрипт как есть — убираем его.
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const { values } = parseArgs({
    args,
    options: {
      model: { type: "string" },
      prompt: { type: "string" },
      enhance: { type: "string" },
      n: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) {
    printUsage();
    return null;
  }

  if (!values.model) throw new Error("--model обязателен");
  if (!isModelKey(values.model)) {
    throw new Error(`--model: неизвестная модель "${values.model}". Допустимо: ${MODEL_KEYS.join(", ")}`);
  }
  if (!values.prompt || values.prompt.trim() === "") throw new Error("--prompt обязателен");

  const n = values.n === undefined ? 1 : Number.parseInt(values.n, 10);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--n: ожидается целое число >= 1, получено "${values.n}"`);

  return {
    model: values.model,
    prompt: values.prompt.trim(),
    enhance: parseBool(values.enhance, false),
    n,
  };
}

// ---------------------------------------------------------------------------
// Enhancer (Gemini Flash, JSON-mode, таймаут 5 с, при ошибке — исходный текст)
// ---------------------------------------------------------------------------

interface EnhancedPrompt {
  prompt_en: string;
  negative_en: string;
}

const ENHANCER_SYSTEM_PROMPT = `You are a prompt engineer for AI image and video generation.
The user writes a request in Russian. Translate it into English and enrich it with concrete
visual details: lighting, composition, lens/focal length, style and mood. For video requests
also describe camera movement. Keep the user's intent intact, do not add unrelated objects.
Return ONLY JSON of the form {"prompt_en": string, "negative_en": string}, where negative_en
lists things to avoid (artifacts, blur, extra limbs, text, watermark, etc.).`;

async function enhancePrompt(prompt: string, kind: MediaKind, apiKey: string): Promise<EnhancedPrompt> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: ENHANCER_SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [{ text: `Media type: ${kind}\nUser request (Russian): ${prompt}` }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          prompt_en: { type: "STRING" },
          negative_en: { type: "STRING" },
        },
        required: ["prompt_en", "negative_en"],
      },
      temperature: 0.7,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = (await res.text().catch(() => "")).replace(/\s+/g, " ").trim();
    throw new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini: пустой ответ");

  const parsed = JSON.parse(text) as Partial<EnhancedPrompt>;
  if (typeof parsed.prompt_en !== "string" || parsed.prompt_en.trim() === "") {
    throw new Error("Gemini: в ответе нет prompt_en");
  }
  return {
    prompt_en: parsed.prompt_en.trim(),
    negative_en: typeof parsed.negative_en === "string" ? parsed.negative_en.trim() : "",
  };
}

// ---------------------------------------------------------------------------
// Разбор ответа fal
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function findFirstUrl(value: unknown, depth = 0): string | undefined {
  if (depth > 5) return undefined;
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

function extractResultUrl(data: unknown, kind: MediaKind): string | undefined {
  if (!isObject(data)) return undefined;
  if (kind === "image") {
    const images = data.images;
    if (Array.isArray(images) && isObject(images[0]) && typeof images[0].url === "string") {
      return images[0].url;
    }
  } else {
    const video = data.video;
    if (isObject(video) && typeof video.url === "string") return video.url;
  }
  return findFirstUrl(data);
}

/** Цена из ответа fal, если провайдер её вернул. В большинстве endpoint'ов её нет. */
function extractPrice(data: unknown): string {
  if (!isObject(data)) return "";
  for (const key of ["price", "cost", "billing", "pricing", "billable_units"]) {
    const v = data[key];
    if (v === undefined || v === null) continue;
    return typeof v === "string" || typeof v === "number" ? String(v) : JSON.stringify(v);
  }
  return "";
}

// ---------------------------------------------------------------------------
// CSV и скачивание
// ---------------------------------------------------------------------------

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function appendCsvRow(fields: string[]): Promise<void> {
  if (!existsSync(RESULTS_CSV)) await writeFile(RESULTS_CSV, CSV_HEADER, "utf8");
  await appendFile(RESULTS_CSV, `${fields.map(csvEscape).join(",")}\n`, "utf8");
}

function guessExtension(url: string, kind: MediaKind): string {
  try {
    const ext = path.extname(new URL(url).pathname).replace(".", "").toLowerCase();
    if (ext && ext.length <= 5) return ext;
  } catch {
    /* ignore */
  }
  return kind === "image" ? "png" : "mp4";
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buf);
}

// ---------------------------------------------------------------------------
// Прогон
// ---------------------------------------------------------------------------

interface RunResult {
  status: "ok" | "error";
  latencyMs: number;
  url: string;
  price: string;
  inferenceTime?: number;
  error?: string;
}

async function runOnce(endpoint: string, input: Record<string, unknown>, kind: MediaKind): Promise<RunResult> {
  const started = performance.now();
  let inferenceTime: number | undefined;
  try {
    const result = await fal.subscribe(endpoint, {
      input,
      logs: false,
      onQueueUpdate: (update) => {
        if (update.status === "COMPLETED" && update.metrics?.inference_time != null) {
          inferenceTime = update.metrics.inference_time;
        }
      },
    });
    const latencyMs = Math.round(performance.now() - started);
    const url = extractResultUrl(result.data, kind) ?? "";
    return { status: "ok", latencyMs, url, price: extractPrice(result.data), inferenceTime };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    return { status: "error", latencyMs, url: "", price: "", error: describeError(err) };
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    // @fal-ai/client кладёт тело ответа в err.body
    const body = (err as Error & { body?: unknown }).body;
    const bodyText = body ? ` ${JSON.stringify(body).slice(0, 300)}` : "";
    return `${err.name}: ${err.message}${bodyText}`;
  }
  return String(err);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  let opts: CliOptions | null;
  try {
    opts = parseCli(process.argv.slice(2));
  } catch (err) {
    console.error(`Ошибка аргументов: ${err instanceof Error ? err.message : String(err)}\n`);
    printUsage();
    return 2;
  }
  if (!opts) return 0;

  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    console.error("FAL_KEY не задан. Экспортируйте ключ fal.ai: export FAL_KEY=...");
    return 1;
  }
  fal.config({ credentials: falKey });

  const spec = MODELS[opts.model];
  const endpoint = resolveEndpoint(spec);

  let effectivePrompt = opts.prompt;
  let negative: string | undefined;
  let enhanceApplied = false;

  if (opts.enhance) {
    const geminiKey = process.env.GEMINI_KEY;
    if (!geminiKey) {
      console.warn("GEMINI_KEY не задан — enhance пропущен, используется исходный текст.");
    } else {
      try {
        const enhanced = await enhancePrompt(opts.prompt, spec.kind, geminiKey);
        effectivePrompt = enhanced.prompt_en;
        negative = enhanced.negative_en || undefined;
        enhanceApplied = true;
        console.log(`[enhance] prompt_en: ${effectivePrompt}`);
        if (negative) console.log(`[enhance] negative_en: ${negative}`);
      } catch (err) {
        console.warn(
          `[enhance] ошибка (${err instanceof Error ? err.message : String(err)}) — используется исходный текст.`,
        );
      }
    }
  }

  const input = spec.buildInput(effectivePrompt, negative);
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`model=${opts.model} endpoint=${endpoint} enhance=${opts.enhance} n=${opts.n}`);
  console.log(`prompt: ${effectivePrompt}`);

  let failures = 0;
  for (let i = 1; i <= opts.n; i++) {
    const timestamp = new Date().toISOString();
    const r = await runOnce(endpoint, input, spec.kind);

    if (r.status === "ok") {
      const inf = r.inferenceTime != null ? ` inference=${r.inferenceTime.toFixed(2)}s` : "";
      const price = r.price ? ` price=${r.price}` : "";
      console.log(`[${i}/${opts.n}] ok ${r.latencyMs}ms${inf}${price} ${r.url || "(url не найден)"}`);
      if (r.url) {
        const safeModel = opts.model.replace(/[^a-z0-9]+/gi, "-");
        const fileName = `${timestamp.replace(/[:.]/g, "-")}-${safeModel}-${i}.${guessExtension(r.url, spec.kind)}`;
        try {
          await downloadFile(r.url, path.join(OUT_DIR, fileName));
          console.log(`        saved out/${fileName}`);
        } catch (err) {
          console.warn(`        не удалось скачать: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } else {
      failures++;
      console.error(`[${i}/${opts.n}] error ${r.latencyMs}ms ${r.error}`);
    }

    await appendCsvRow([
      timestamp,
      opts.model,
      String(enhanceApplied),
      String(r.latencyMs),
      r.status,
      r.price,
      r.url,
    ]);
  }

  console.log(`done: ${opts.n - failures} ok, ${failures} error → ${path.relative(process.cwd(), RESULTS_CSV)}`);
  return failures === opts.n ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("Непредвиденная ошибка:", err);
    process.exit(1);
  });

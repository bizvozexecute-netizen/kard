import type { Generation, PrismaClient } from "@kadr/db";
import type { EnhancerService, MediaKind } from "@kadr/enhancer";
import type { LedgerService } from "@kadr/ledger";
import type { GenPollResult, ProviderError, RoutedSubmitResult } from "@kadr/providers";
import type { GenSubmitRequest } from "@kadr/providers";
import {
  type ErrorCode,
  type GenEvent,
  type GenStatus,
  isTerminalGenStatus,
  type OperationKind,
  pollProfileFor,
  type ProviderChain,
  providerChainSchema,
} from "@kadr/shared";
import type { StorageLike } from "@kadr/storage";

export interface NotifyPayload {
  type: "gen_ready" | "gen_failed";
  userId: string;
  payload: { generationId: string; errorCode?: string };
}

export interface PipelineLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
  fatal(obj: Record<string, unknown>, msg: string): void;
}

/** Структурный интерфейс роутера — в тестах подменяется моком. */
export interface RouterLike {
  submit(chain: ProviderChain, req: Omit<GenSubmitRequest, "model">): Promise<RoutedSubmitResult>;
  poll(provider: string, jobId: string): Promise<GenPollResult>;
  cancel(provider: string, jobId: string): Promise<void>;
}

export interface PipelineDeps {
  prisma: PrismaClient;
  ledger: LedgerService;
  router: RouterLike;
  enhancer: Pick<EnhancerService, "enhance">;
  moderation: { check(text: string): Promise<{ ok: true } | { ok: false; reason: string }> };
  storage: StorageLike;
  publish(event: GenEvent): Promise<void>;
  notify(job: NotifyPayload): Promise<void>;
  logger: PipelineLogger;
  /** Переопределения для тестов */
  pollOverrides?: { intervalMs?: number; deadlineMs?: number };
  downloadTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Процессор генерации (ТЗ §8). Идемпотентен: статус проверяется на входе,
 * RUNNING с providerJobId продолжает поллинг без пересабмита, commit/release
 * защищены ключами ledger. CANCELED (отменили через api) — выход без движения денег.
 */
export async function runGenerationPipeline(
  deps: PipelineDeps,
  generationId: string,
): Promise<void> {
  const { prisma, logger } = deps;
  let gen = await prisma.generation.findUnique({ where: { id: generationId } });
  if (!gen) {
    logger.warn({ generationId }, "generation not found, skipping job");
    return;
  }
  if (isTerminalGenStatus(gen.status)) {
    logger.info({ generationId, status: gen.status }, "generation already terminal, no-op");
    return;
  }

  try {
    if (gen.status === "RUNNING" && gen.providerJobId && gen.provider) {
      await pollLoop(deps, gen);
      return;
    }

    // --- MODERATING -------------------------------------------------------
    gen = await transition(deps, gen, ["QUEUED", "MODERATING", "ENHANCING"], "MODERATING");
    if (!gen) return; // отменили
    const verdict = await deps.moderation.check(gen.promptRaw ?? "");
    if (!verdict.ok) {
      await fail(deps, gen, "MODERATION_BLOCKED");
      return;
    }

    // --- ENHANCING --------------------------------------------------------
    gen = await transition(deps, gen, ["MODERATING"], "ENHANCING");
    if (!gen) return;
    const params = (gen.params ?? {}) as Record<string, unknown>;
    let promptFinal = gen.promptRaw ?? "";
    let negative: string | undefined;
    if (params.enhance !== false && gen.promptRaw) {
      const enhanced = await deps.enhancer.enhance(gen.promptRaw, mediaKindOf(gen.kind));
      if (enhanced) {
        promptFinal = enhanced.promptEn;
        negative = enhanced.negativeEn || undefined;
      }
    }
    gen = await prisma.generation.update({
      where: { id: gen.id },
      data: { promptFinal, negativePrompt: negative ?? null },
    });

    // --- RUNNING: submit ---------------------------------------------------
    const operation = await prisma.operation.findUniqueOrThrow({
      where: { key: gen.operationKey },
    });
    const chain = providerChainSchema.parse(operation.providerChain);
    const submitParams: Record<string, unknown> = { ...params };
    delete submitParams.enhance;
    if (gen.kind === "IMAGE" && gen.variants > 1) submitParams.num_images = gen.variants;

    const routed = await deps.router.submit(chain, {
      prompt: promptFinal,
      negative,
      params: submitParams,
    });

    gen = await prisma.generation.update({
      where: { id: gen.id },
      data: {
        status: "RUNNING",
        provider: routed.provider,
        model: routed.model,
        providerJobId: routed.jobId,
        startedAt: new Date(),
      },
    });
    await deps.publish({ id: gen.id, status: "RUNNING", ts: Date.now() });

    await pollLoop(deps, gen);
  } catch (err) {
    const fresh = await prisma.generation.findUnique({ where: { id: generationId } });
    if (!fresh || isTerminalGenStatus(fresh.status)) throw err;
    const code = (err as ProviderError).code ?? "PROVIDER_ERROR";
    logger.error({ generationId, err: String(err) }, "generation pipeline failed");
    await fail(deps, fresh, isKnownErrorCode(code) ? code : "PROVIDER_ERROR");
  }
}

/** Поллинг провайдера с дедлайном; между тиками проверяем отмену в БД. */
async function pollLoop(deps: PipelineDeps, gen: Generation): Promise<void> {
  const profile = pollProfileFor(gen.kind as OperationKind);
  const intervalMs = deps.pollOverrides?.intervalMs ?? profile.intervalMs;
  const deadlineMs = deps.pollOverrides?.deadlineMs ?? profile.deadlineMs;
  const sleep = deps.sleep ?? defaultSleep;
  const startedAt = gen.startedAt?.getTime() ?? Date.now();

  for (;;) {
    const fresh = await deps.prisma.generation.findUniqueOrThrow({ where: { id: gen.id } });
    if (fresh.status === "CANCELED") {
      await deps.router.cancel(fresh.provider!, fresh.providerJobId!).catch(() => undefined);
      deps.logger.info({ generationId: gen.id }, "generation canceled during polling");
      return;
    }
    if (isTerminalGenStatus(fresh.status)) return; // другой воркер завершил

    let poll: GenPollResult;
    try {
      poll = await deps.router.poll(fresh.provider!, fresh.providerJobId!);
    } catch (err) {
      deps.logger.warn({ generationId: gen.id, err: String(err) }, "poll error, will retry");
      poll = { status: "running" };
    }

    if (poll.status === "succeeded") {
      await succeed(deps, fresh, poll);
      return;
    }
    if (poll.status === "failed") {
      await fail(deps, fresh, poll.errorCode ?? "PROVIDER_ERROR");
      return;
    }

    if (poll.progress !== undefined) {
      await deps.publish({
        id: gen.id,
        status: "RUNNING",
        progress: poll.progress,
        ts: Date.now(),
      });
    }

    if (Date.now() - startedAt > deadlineMs) {
      await fail(deps, fresh, "PROVIDER_TIMEOUT");
      return;
    }
    await sleep(intervalMs);
  }
}

async function succeed(deps: PipelineDeps, gen: Generation, poll: GenPollResult): Promise<void> {
  const outputs = poll.outputs ?? [];
  const resultKeys: string[] = [];
  const fetchImpl = deps.fetchImpl ?? fetch;

  for (let i = 0; i < outputs.length; i++) {
    const output = outputs[i]!;
    const res = await fetchImpl(output.url, {
      signal: AbortSignal.timeout(deps.downloadTimeoutMs ?? 120_000),
    });
    if (!res.ok || !res.body) throw new Error(`output download failed: HTTP ${res.status}`);
    const key = `results/${gen.userId}/${gen.id}/${i}.${extFromMime(output.mime)}`;
    const buffer = Buffer.from(await res.arrayBuffer());
    await deps.storage.put(key, buffer, output.mime);
    resultKeys.push(key);
  }

  const operation = await deps.prisma.operation.findUnique({ where: { key: gen.operationKey } });
  const costUsdActual = poll.costUsd ?? Number(operation?.cogsUsdEst ?? 0);

  await deps.prisma.generation.update({
    where: { id: gen.id },
    data: { status: "SUCCEEDED", resultKeys, costUsdActual, finishedAt: new Date() },
  });
  await deps.ledger.commit(
    gen.userId,
    BigInt(gen.costCredits),
    { refType: "generation", refId: gen.id },
    `commit:${gen.id}`,
  );

  const resultUrls = await Promise.all(resultKeys.map((k) => deps.storage.getSignedUrl(k)));
  await deps.publish({ id: gen.id, status: "SUCCEEDED", resultUrls, ts: Date.now() });
  await deps.notify({ type: "gen_ready", userId: gen.userId, payload: { generationId: gen.id } });
  deps.logger.info({ generationId: gen.id, outputs: resultKeys.length }, "generation succeeded");
}

async function fail(deps: PipelineDeps, gen: Generation, errorCode: ErrorCode): Promise<void> {
  await deps.prisma.generation.update({
    where: { id: gen.id },
    data: { status: "FAILED", errorCode, finishedAt: new Date() },
  });
  try {
    await deps.ledger.release(
      gen.userId,
      BigInt(gen.costCredits),
      { refType: "generation", refId: gen.id },
      `release:${gen.id}`,
    );
  } catch (err) {
    // release после commit невозможен по бизнес-логике; если случился — это баг, кричим
    deps.logger.fatal({ generationId: gen.id, err: String(err) }, "release failed after commit?");
  }
  await deps.publish({ id: gen.id, status: "FAILED", errorCode, ts: Date.now() });
  await deps.notify({
    type: "gen_failed",
    userId: gen.userId,
    payload: { generationId: gen.id, errorCode },
  });
  deps.logger.info({ generationId: gen.id, errorCode }, "generation failed, credits released");
}

/**
 * Переход статуса с защитой от гонки с cancel: условный UPDATE; 0 строк и статус
 * CANCELED → вернуть null (выход без движения денег).
 */
async function transition(
  deps: PipelineDeps,
  gen: Generation,
  from: GenStatus[],
  to: GenStatus,
): Promise<Generation | null> {
  if (gen.status === to) return gen;
  const updated = await deps.prisma.generation.updateMany({
    where: { id: gen.id, status: { in: from } },
    data: { status: to },
  });
  const fresh = await deps.prisma.generation.findUniqueOrThrow({ where: { id: gen.id } });
  if (updated.count === 0) {
    if (fresh.status === "CANCELED" || isTerminalGenStatus(fresh.status)) return null;
    return fresh;
  }
  await deps.publish({ id: gen.id, status: to, ts: Date.now() });
  return fresh;
}

function mediaKindOf(kind: string): MediaKind {
  if (kind === "VIDEO") return "video";
  if (kind === "AUDIO") return "audio";
  return "image";
}

const KNOWN_CODES: ReadonlySet<string> = new Set([
  "PROVIDER_ERROR",
  "PROVIDER_TIMEOUT",
  "UPSTREAM_OVERLOAD",
  "NSFW_OUTPUT",
  "MODERATION_BLOCKED",
]);
function isKnownErrorCode(code: string): code is ErrorCode {
  return KNOWN_CODES.has(code);
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
  };
  return map[mime] ?? "bin";
}

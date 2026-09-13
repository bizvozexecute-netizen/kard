import { Inject, Injectable } from "@nestjs/common";
import { type Generation, Prisma } from "@kadr/db";
import { LedgerService } from "@kadr/ledger";
import type { StorageLike } from "@kadr/storage";
import {
  AppError,
  type CreateGenerationDto,
  type CreateGenerationResponse,
  ErrorCode,
  type GenerationDto,
  genChannel,
  type GenEvent,
  isTerminalGenStatus,
  MAX_VARIANTS,
  NotFoundError,
  providerChainSchema,
  ValidationError,
} from "@kadr/shared";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { STORAGE } from "../storage/storage.module";
import { GenerationQueue } from "./generation-queue";
import { ParamsValidator } from "./params-validator";

export interface ListParams {
  cursor?: string;
  limit: number;
  kind?: Generation["kind"];
}

@Injectable()
export class GenerationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly queue: GenerationQueue,
    private readonly paramsValidator: ParamsValidator,
    private readonly redis: RedisService,
    @Inject(STORAGE) private readonly storage: StorageLike,
  ) {}

  /**
   * Создание генерации (ТЗ §8): повтор Idempotency-Key возвращает существующую (и
   * перезакидывает job — BullMQ дедупит), иначе insert QUEUED → reserve → enqueue.
   * При нехватке кредитов свежесозданная строка удаляется и наружу идёт 402.
   */
  async create(
    userId: string,
    dto: CreateGenerationDto,
    idemKeyRaw: string,
  ): Promise<{ response: CreateGenerationResponse; created: boolean }> {
    const idempotencyKey = `${userId}:${idemKeyRaw}`;

    if (dto.presetId !== undefined) {
      // Каталог пресетов появится в следующих сессиях
      throw new ValidationError({ reason: "presets_not_supported" });
    }

    const operation = await this.prisma.operation.findUnique({ where: { key: dto.operationKey } });
    if (!operation || !operation.isActive) throw new NotFoundError({ entity: "operation" });
    if (dto.variants > 1 && operation.kind !== "IMAGE") {
      throw new ValidationError({ reason: "variants_only_for_images" });
    }
    if (dto.variants > MAX_VARIANTS) throw new ValidationError({ reason: "too_many_variants" });
    providerChainSchema.parse(operation.providerChain); // каталог обязан быть валиден
    // paramsSchema операции описывает полный вход модели: prompt/imageId + params
    this.paramsValidator.validate(operation.key, operation.updatedAt, operation.paramsSchema, {
      ...dto.params,
      ...(dto.prompt !== undefined ? { prompt: dto.prompt } : {}),
      ...(dto.inputImageId !== undefined ? { imageId: dto.inputImageId } : {}),
    });

    let inputImageKey: string | null = null;
    if (dto.inputImageId) {
      const upload = await this.prisma.upload.findFirst({
        where: { id: dto.inputImageId, userId },
      });
      if (!upload) throw new NotFoundError({ entity: "upload" });
      inputImageKey = upload.key;
    }

    const costCredits = operation.priceCredits * dto.variants;

    let generation: Generation;
    try {
      generation = await this.prisma.generation.create({
        data: {
          userId,
          operationKey: operation.key,
          kind: operation.kind,
          promptRaw: dto.prompt ?? null,
          presetId: null,
          presetInputs: (dto.presetInputs as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
          inputImageKey,
          params: { ...dto.params, enhance: dto.enhance } as Prisma.InputJsonValue,
          variants: dto.variants,
          costCredits,
          idempotencyKey,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const existing = await this.prisma.generation.findUniqueOrThrow({
          where: { idempotencyKey },
        });
        if (!isTerminalGenStatus(existing.status)) await this.queue.enqueue(existing.id);
        const balance = await this.ledger.getBalance(userId);
        return {
          created: false,
          response: {
            id: existing.id,
            status: existing.status,
            costCredits: existing.costCredits,
            balanceAfterReserve: balance.balance.toString(),
          },
        };
      }
      throw err;
    }

    let balanceAfterReserve: bigint;
    try {
      const balance = await this.ledger.reserve(userId, BigInt(costCredits), {
        refType: "generation",
        refId: generation.id,
      });
      balanceAfterReserve = balance.balance;
    } catch (err) {
      await this.prisma.generation.delete({ where: { id: generation.id } }).catch(() => undefined);
      throw err;
    }

    await this.queue.enqueue(generation.id);

    return {
      created: true,
      response: {
        id: generation.id,
        status: generation.status,
        costCredits,
        balanceAfterReserve: balanceAfterReserve.toString(),
      },
    };
  }

  async get(userId: string, id: string): Promise<GenerationDto> {
    const generation = await this.prisma.generation.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!generation) throw new NotFoundError({ entity: "generation" });
    return this.toDto(generation);
  }

  async list(
    userId: string,
    params: ListParams,
  ): Promise<{ items: GenerationDto[]; nextCursor: string | null }> {
    const after = params.cursor ? decodeCursor(params.cursor) : null;
    const rows = await this.prisma.generation.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(params.kind ? { kind: params.kind } : {}),
        ...(after
          ? {
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: params.limit + 1,
    });
    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;
    const last = page[page.length - 1];
    return {
      items: await Promise.all(page.map((g) => this.toDto(g))),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    };
  }

  async softDelete(userId: string, id: string): Promise<void> {
    const updated = await this.prisma.generation.updateMany({
      where: { id, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (updated.count === 0) throw new NotFoundError({ entity: "generation" });
  }

  /** Отмена возможна только до отправки провайдеру: QUEUED | MODERATING (ТЗ §8). */
  async cancel(userId: string, id: string): Promise<GenerationDto> {
    const generation = await this.prisma.generation.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!generation) throw new NotFoundError({ entity: "generation" });

    const updated = await this.prisma.generation.updateMany({
      where: { id, userId, status: { in: ["QUEUED", "MODERATING"] } },
      data: { status: "CANCELED", finishedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new AppError(ErrorCode.ILLEGAL_TRANSITION, 409, {
        reason: "cancel_not_allowed",
        status: generation.status,
      });
    }

    await this.ledger.release(
      userId,
      BigInt(generation.costCredits),
      { refType: "generation", refId: id },
      `release:${id}`,
    );

    await this.publish({ id, status: "CANCELED", ts: Date.now() });
    return this.get(userId, id);
  }

  private async publish(event: GenEvent): Promise<void> {
    if (this.redis.status === "wait") await this.redis.connect();
    await this.redis.publish(genChannel(event.id), JSON.stringify(event)).catch(() => undefined);
  }

  async toDto(g: Generation): Promise<GenerationDto> {
    const resultUrls = await Promise.all(g.resultKeys.map((key) => this.storage.getSignedUrl(key)));
    return {
      id: g.id,
      operationKey: g.operationKey,
      kind: g.kind,
      status: g.status,
      prompt: g.promptRaw,
      variants: g.variants,
      costCredits: g.costCredits,
      resultUrls,
      errorCode: (g.errorCode as GenerationDto["errorCode"]) ?? null,
      createdAt: g.createdAt.toISOString(),
      startedAt: g.startedAt?.toISOString() ?? null,
      finishedAt: g.finishedAt?.toISOString() ?? null,
    };
  }
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function encodeCursor(g: Pick<Generation, "createdAt" | "id">): string {
  return Buffer.from(`${g.createdAt.toISOString()}|${g.id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const sep = raw.indexOf("|");
  const createdAt = new Date(sep > 0 ? raw.slice(0, sep) : "");
  const id = sep > 0 ? raw.slice(sep + 1) : "";
  if (Number.isNaN(createdAt.getTime()) || !id) throw new ValidationError({ reason: "bad_cursor" });
  return { createdAt, id };
}

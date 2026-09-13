import { z } from "zod";
import { errorCodeSchema } from "./errors";
import { operationKindSchema, type OperationKind } from "./catalog";
import { creditsStringSchema } from "./ledger";
import { cursorQuerySchema, paginatedSchema } from "./zod/common";

export const genStatusSchema = z.enum([
  "QUEUED",
  "MODERATING",
  "ENHANCING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
]);
export type GenStatus = z.infer<typeof genStatusSchema>;

export const TERMINAL_GEN_STATUSES: readonly GenStatus[] = ["SUCCEEDED", "FAILED", "CANCELED"];
export function isTerminalGenStatus(status: string): boolean {
  return (TERMINAL_GEN_STATUSES as string[]).includes(status);
}

export const MAX_PROMPT_LENGTH = 1500;
export const MAX_VARIANTS = 4;

/** POST /v1/generations (плюс обязательный заголовок Idempotency-Key) */
export const createGenerationSchema = z
  .object({
    operationKey: z.string().min(1).max(64),
    prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH).optional(),
    presetId: z.string().min(1).max(64).optional(),
    presetInputs: z.record(z.unknown()).optional(),
    inputImageId: z.string().min(1).max(64).optional(),
    params: z.record(z.unknown()).default({}),
    variants: z.number().int().min(1).max(MAX_VARIANTS).default(1),
    enhance: z.boolean().default(true),
  })
  .refine((v) => (v.prompt !== undefined) !== (v.presetId !== undefined), {
    message: "нужен ровно один из prompt или presetId",
  });
export type CreateGenerationDto = z.infer<typeof createGenerationSchema>;

export const createGenerationResponseSchema = z.object({
  id: z.string(),
  status: genStatusSchema,
  costCredits: z.number().int().positive(),
  balanceAfterReserve: creditsStringSchema,
});
export type CreateGenerationResponse = z.infer<typeof createGenerationResponseSchema>;

/** Публичный DTO генерации (без providerJobId и прочей кухни) */
export const generationSchema = z.object({
  id: z.string(),
  operationKey: z.string(),
  kind: operationKindSchema,
  status: genStatusSchema,
  prompt: z.string().nullable(),
  variants: z.number().int(),
  costCredits: z.number().int(),
  resultUrls: z.array(z.string()),
  errorCode: errorCodeSchema.nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});
export type GenerationDto = z.infer<typeof generationSchema>;

export const listGenerationsQuerySchema = cursorQuerySchema.extend({
  kind: operationKindSchema.optional(),
});
export const listGenerationsResponseSchema = paginatedSchema(generationSchema);

/** Событие в Redis pub/sub `gen:{id}` и в SSE-потоке */
export const genEventSchema = z.object({
  id: z.string(),
  status: genStatusSchema,
  progress: z.number().min(0).max(100).optional(),
  resultUrls: z.array(z.string()).optional(),
  errorCode: errorCodeSchema.optional(),
  ts: z.number(),
});
export type GenEvent = z.infer<typeof genEventSchema>;

export const genChannel = (id: string) => `gen:${id}`;

/** Поллинг провайдера (ТЗ §8): image 2 с / дедлайн 90 с; video/audio 5 с / 600 с */
export interface PollProfile {
  intervalMs: number;
  deadlineMs: number;
}
export function pollProfileFor(kind: OperationKind): PollProfile {
  return kind === "VIDEO" || kind === "AUDIO"
    ? { intervalMs: 5_000, deadlineMs: 600_000 }
    : { intervalMs: 2_000, deadlineMs: 90_000 };
}

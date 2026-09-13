import { z } from "zod";

/** Звено цепочки провайдеров операции (Operation.providerChain). */
export const providerChainLinkSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  /** Дополнительные параметры модели, мержатся в input при submit */
  params: z.record(z.unknown()).optional(),
});
export type ProviderChainLink = z.infer<typeof providerChainLinkSchema>;

export const providerChainSchema = z.array(providerChainLinkSchema).min(1);
export type ProviderChain = z.infer<typeof providerChainSchema>;

export const genPollStatusSchema = z.enum(["running", "succeeded", "failed"]);
export type GenPollStatus = z.infer<typeof genPollStatusSchema>;

export const genOutputSchema = z.object({
  url: z.string().url(),
  mime: z.string().min(1),
});
export type GenOutput = z.infer<typeof genOutputSchema>;

/** Circuit breaker провайдеров: 5 ошибок за 10 мин → скип звена на 10 мин (ТЗ §7). */
export const CB_ERROR_THRESHOLD = 5;
export const CB_WINDOW_SEC = 600;
export const CB_OPEN_SEC = 600;

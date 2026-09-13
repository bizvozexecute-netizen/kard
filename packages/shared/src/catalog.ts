import { z } from "zod";
import { creditsStringSchema } from "./ledger";

export const operationKindSchema = z.enum(["IMAGE", "VIDEO", "AUDIO", "EDIT", "UPSCALE"]);
export type OperationKind = z.infer<typeof operationKindSchema>;

export const operationTierSchema = z.enum(["DRAFT", "STANDARD", "PREMIUM"]);
export type OperationTier = z.infer<typeof operationTierSchema>;

/**
 * Операция каталога в публичном ответе. Внутренние поля (cogsUsdEst, providerChain)
 * наружу не отдаются.
 */
export const catalogOperationSchema = z.object({
  key: z.string(),
  kind: operationKindSchema,
  tier: operationTierSchema,
  title: z.string(),
  priceCredits: z.number().int().positive(),
  /** JSON-схема параметров операции — фронт строит по ней форму */
  paramsSchema: z.record(z.unknown()),
  etaSec: z.number().int().positive(),
  sort: z.number().int(),
});
export type CatalogOperationDto = z.infer<typeof catalogOperationSchema>;

/** GET /v1/catalog */
export const catalogResponseSchema = z.object({
  operations: z.array(catalogOperationSchema),
});
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;

export const packageSchema = z.object({
  id: z.string(),
  /** Цена в рублях целиком (в копейки переводит модуль payments) */
  priceRub: z.number().int().positive(),
  credits: creditsStringSchema,
  bonusPct: z.number().int().min(0),
  badge: z.string().nullable(),
  sort: z.number().int(),
});
export type PackageDto = z.infer<typeof packageSchema>;

/** GET /v1/packages */
export const packagesResponseSchema = z.object({
  packages: z.array(packageSchema),
});
export type PackagesResponse = z.infer<typeof packagesResponseSchema>;

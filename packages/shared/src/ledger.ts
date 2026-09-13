import { z } from "zod";
import { cursorQuerySchema, paginatedSchema } from "./zod/common";

/** Типы записей журнала кредитов (совпадают с enum LedgerType в Prisma). */
export const LedgerType = {
  PURCHASE: "PURCHASE",
  SPEND: "SPEND",
  REFUND: "REFUND",
  BONUS: "BONUS",
  DAILY: "DAILY",
  REFERRAL: "REFERRAL",
  MANUAL: "MANUAL",
} as const;
export const ledgerTypeSchema = z.nativeEnum(LedgerType);
export type LedgerType = z.infer<typeof ledgerTypeSchema>;

/** Типы начислений, допустимые для LedgerService.grant */
export const grantTypeSchema = z.enum(["BONUS", "DAILY", "REFERRAL", "PURCHASE", "MANUAL"]);
export type GrantType = z.infer<typeof grantTypeSchema>;

/** BIGINT в JSON передаём строкой без потери точности */
export const bigintStringSchema = z.string().regex(/^-?\d+$/, "ожидается целое число строкой");
export const creditsStringSchema = z.string().regex(/^\d+$/, "ожидается неотрицательное целое");

export const balanceSchema = z.object({
  balance: creditsStringSchema,
  reserved: creditsStringSchema,
});
export type BalanceDto = z.infer<typeof balanceSchema>;

export const ledgerEntrySchema = z.object({
  id: z.string(),
  delta: bigintStringSchema,
  type: ledgerTypeSchema,
  refType: z.string().nullable(),
  refId: z.string().nullable(),
  balanceAfter: creditsStringSchema,
  comment: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type LedgerEntryDto = z.infer<typeof ledgerEntrySchema>;

export const ledgerEntriesQuerySchema = cursorQuerySchema;
export const ledgerEntriesResponseSchema = paginatedSchema(ledgerEntrySchema);
export type LedgerEntriesResponse = z.infer<typeof ledgerEntriesResponseSchema>;

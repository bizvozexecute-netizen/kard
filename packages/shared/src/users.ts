import { z } from "zod";
import { creditsStringSchema } from "./ledger";

export const streakSchema = z.object({
  /** Текущая серия дней (0, если серия прервана) */
  days: z.number().int().min(0),
  todayClaimed: z.boolean(),
});
export type StreakDto = z.infer<typeof streakSchema>;

/** GET /v1/me */
export const meSchema = z.object({
  id: z.string(),
  /** Telegram id строкой (BigInt) */
  tgId: z.string(),
  name: z.string(),
  username: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  email: z.string().email().nullable(),
  notificationsEnabled: z.boolean(),
  balance: creditsStringSchema,
  reserved: creditsStringSchema,
  streak: streakSchema,
  referralCode: z.string().length(8),
  createdAt: z.string().datetime(),
});
export type MeDto = z.infer<typeof meSchema>;

/** PATCH /v1/me */
export const patchMeSchema = z
  .object({
    email: z.string().trim().email().max(254).optional(),
    notificationsEnabled: z.boolean().optional(),
  })
  .refine((v) => v.email !== undefined || v.notificationsEnabled !== undefined, {
    message: "укажите хотя бы одно поле",
  });
export type PatchMeDto = z.infer<typeof patchMeSchema>;

/** POST /v1/me/daily-claim */
export const dailyClaimResponseSchema = z.object({
  /** Начислено кредитов */
  credited: creditsStringSchema,
  streak: streakSchema,
  balance: creditsStringSchema,
  /** Дата бонуса, календарный день UTC */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type DailyClaimResponse = z.infer<typeof dailyClaimResponseSchema>;

/** Размер ежедневного бонуса по номеру дня серии (ТЗ: дни 1–6 → 5, день 7+ → 15) */
export const DAILY_BONUS = { BASE: 5n, STREAK_7_PLUS: 15n } as const;
export const SIGNUP_BONUS = 50n;

import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@kadr/db";
import { LedgerService } from "@kadr/ledger";
import { AppError, DAILY_BONUS, type DailyClaimResponse, ErrorCode } from "@kadr/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CLOCK, type Clock, nextUtcMidnight, shiftDate, utcDateString } from "./clock";

export class AlreadyClaimedError extends AppError {
  constructor(date: string, nextClaimAt: Date) {
    super(ErrorCode.ALREADY_CLAIMED, 409, { date, nextClaimAt: nextClaimAt.toISOString() });
    this.name = "AlreadyClaimedError";
  }
}

/** Дни 1–6 серии → 5 кредитов, день 7 и дальше → 15 (ТЗ §5 п.7) */
export function dailyBonusFor(streakDay: number): bigint {
  return streakDay >= 7 ? DAILY_BONUS.STREAK_7_PLUS : DAILY_BONUS.BASE;
}

interface ClaimTxResult {
  alreadyClaimed: boolean;
  current: number;
}

/**
 * Ежедневный бонус. Уникальность дня — PK daily_claims(user_id, date): вставка
 * `ON CONFLICT DO NOTHING` (0 строк = уже отмечено; при гонке проигравший ждёт блокировку
 * и тоже получает 0). Стрик считается в той же транзакции. Начисление через ledger.grant
 * с ключом daily:<user>:<date> выполняется ВСЕГДА (идемпотентно): при гонке или падении
 * между транзакцией и начислением кредиты всё равно начисляются ровно один раз.
 */
@Injectable()
export class DailyClaimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async claim(userId: string): Promise<DailyClaimResponse> {
    const now = this.clock();
    const today = utcDateString(now);

    const { alreadyClaimed, current } = await this.prisma.$transaction((tx) =>
      this.claimTx(tx, userId, today),
    );

    const credited = dailyBonusFor(current);
    await this.ledger.grant(
      userId,
      credited,
      "DAILY",
      { refType: "daily", refId: today },
      `daily:${userId}:${today}`,
      `day ${current}`,
    );

    if (alreadyClaimed) throw new AlreadyClaimedError(today, nextUtcMidnight(now));

    const { balance } = await this.ledger.getBalance(userId);
    return {
      credited: credited.toString(),
      streak: { days: current, todayClaimed: true },
      balance: balance.toString(),
      date: today,
    };
  }

  private async claimTx(
    tx: Prisma.TransactionClient,
    userId: string,
    today: string,
  ): Promise<ClaimTxResult> {
    const inserted = await tx.$executeRaw`
      INSERT INTO "daily_claims" ("user_id", "date", "created_at")
      VALUES (${userId}, ${today}, now())
      ON CONFLICT ("user_id", "date") DO NOTHING`;

    const streak = await tx.streak.findUnique({ where: { userId } });

    if (inserted === 0) {
      // День уже отмечен (повтор или проигранная гонка): стрик уже обновлён
      return { alreadyClaimed: true, current: streak?.current ?? 1 };
    }

    const continues = streak?.lastClaimDate === shiftDate(today, -1);
    const current = continues ? (streak?.current ?? 0) + 1 : 1;
    const best = Math.max(current, streak?.best ?? 0);

    await tx.streak.upsert({
      where: { userId },
      create: { userId, current, best, lastClaimDate: today },
      update: { current, best, lastClaimDate: today },
    });
    return { alreadyClaimed: false, current };
  }
}

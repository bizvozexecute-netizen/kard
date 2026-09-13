import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type Streak, type User } from "@kadr/db";
import { AccountNotFoundError, LedgerService } from "@kadr/ledger";
import {
  type MeDto,
  NotFoundError,
  type PatchMeDto,
  REFERRAL_START_PREFIX,
  SIGNUP_BONUS,
  type StreakDto,
} from "@kadr/shared";
import type { TelegramProfile } from "../auth/telegram-signature";
import { PrismaService } from "../prisma/prisma.service";
import { isReferralCode, referralCodeCandidate } from "./base58";
import { CLOCK, type Clock, shiftDate, utcDateString } from "./clock";

export interface UpsertOptions {
  /** start_param из Mini App: ref_<code> → referredBy при создании */
  startParam?: string;
}

export interface UpsertResult {
  user: User;
  isNew: boolean;
}

const MAX_CODE_ATTEMPTS = 8;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Пользователь + кредитный счёт создаются в одной транзакции; существующему обновляется профиль.
   * Гонка двух первых входов: проигравший ловит unique(telegramId) и повторяет как обновление.
   */
  async upsertFromTelegram(
    profile: TelegramProfile,
    opts: UpsertOptions = {},
  ): Promise<UpsertResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction((tx) => this.upsertTx(tx, profile, opts));
      } catch (err) {
        if (attempt === 0 && isUniqueViolation(err)) continue;
        throw err;
      }
    }
  }

  private async upsertTx(
    tx: Prisma.TransactionClient,
    profile: TelegramProfile,
    opts: UpsertOptions,
  ): Promise<UpsertResult> {
    const now = this.clock();
    const profileFields = {
      firstName: profile.firstName,
      lastName: profile.lastName ?? null,
      username: profile.username ?? null,
      avatarUrl: profile.photoUrl ?? null,
      languageCode: profile.languageCode ?? null,
    };

    const existing = await tx.user.findUnique({ where: { telegramId: profile.telegramId } });
    if (existing) {
      const user = await tx.user.update({
        where: { id: existing.id },
        data: { ...profileFields, lastLoginAt: now },
      });
      return { user, isNew: false };
    }

    const referredBy = await this.resolveReferrer(tx, opts.startParam);
    // Создаём с временным уникальным кодом, затем меняем на код, выведенный из id
    const created = await tx.user.create({
      data: {
        telegramId: profile.telegramId,
        ...profileFields,
        referralCode: `tmp_${profile.telegramId.toString()}_${now.getTime()}`,
        referredBy: referredBy && referredBy !== null ? referredBy : null,
        lastLoginAt: now,
      },
    });
    const user = await this.assignReferralCode(tx, created);

    await tx.$executeRaw`
      INSERT INTO "credit_accounts" ("user_id", "balance", "reserved", "updated_at")
      VALUES (${user.id}, 0, 0, now())
      ON CONFLICT ("user_id") DO NOTHING`;

    return { user, isNew: true };
  }

  private async assignReferralCode(tx: Prisma.TransactionClient, user: User): Promise<User> {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const referralCode = referralCodeCandidate(user.id, attempt);
      const clash = await tx.user.findUnique({ where: { referralCode }, select: { id: true } });
      if (clash) continue;
      return tx.user.update({ where: { id: user.id }, data: { referralCode } });
    }
    throw new Error(`referral code collision for user ${user.id}`);
  }

  private async resolveReferrer(
    tx: Prisma.TransactionClient,
    startParam: string | undefined,
  ): Promise<string | null> {
    if (!startParam?.startsWith(REFERRAL_START_PREFIX)) return null;
    const code = startParam.slice(REFERRAL_START_PREFIX.length);
    if (!isReferralCode(code)) return null;
    const referrer = await tx.user.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
    return referrer?.id ?? null;
  }

  /**
   * Стартовый бонус 50 кредитов — один раз на пользователя. Идемпотентность двойная:
   * ключ ledger `signup:<id>` и отметка signupBonusGrantedAt.
   */
  async grantSignupBonusIfNeeded(user: Pick<User, "id" | "signupBonusGrantedAt">): Promise<void> {
    if (user.signupBonusGrantedAt) return;
    await this.ledger.grant(
      user.id,
      SIGNUP_BONUS,
      "BONUS",
      { refType: "signup", refId: user.id },
      `signup:${user.id}`,
      "welcome bonus",
    );
    await this.prisma.user.updateMany({
      where: { id: user.id, signupBonusGrantedAt: null },
      data: { signupBonusGrantedAt: this.clock() },
    });
  }

  async getMe(userId: string): Promise<MeDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { streak: true },
    });
    if (!user) throw new NotFoundError({ entity: "user" });
    const balance = await this.balanceOf(userId);
    return toMeDto(user, balance, streakDto(user.streak, utcDateString(this.clock())));
  }

  async patchMe(userId: string, dto: PatchMeDto): Promise<MeDto> {
    const data: Prisma.UserUpdateInput = {};
    if (dto.email !== undefined) data.email = dto.email.toLowerCase();
    if (dto.notificationsEnabled !== undefined)
      data.notificationsEnabled = dto.notificationsEnabled;
    const updated = await this.prisma.user.updateMany({ where: { id: userId }, data });
    if (updated.count === 0) throw new NotFoundError({ entity: "user" });
    return this.getMe(userId);
  }

  private async balanceOf(userId: string): Promise<{ balance: bigint; reserved: bigint }> {
    try {
      return await this.ledger.getBalance(userId);
    } catch (err) {
      if (!(err instanceof AccountNotFoundError)) throw err;
      await this.ledger.ensureAccount(userId);
      return { balance: 0n, reserved: 0n };
    }
  }
}

export function streakDto(streak: Streak | null, today: string): StreakDto {
  if (!streak?.lastClaimDate) return { days: 0, todayClaimed: false };
  const todayClaimed = streak.lastClaimDate === today;
  const alive = todayClaimed || streak.lastClaimDate === shiftDate(today, -1);
  return { days: alive ? streak.current : 0, todayClaimed };
}

export function toMeDto(
  user: User,
  balance: { balance: bigint; reserved: bigint },
  streak: StreakDto,
): MeDto {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return {
    id: user.id,
    tgId: user.telegramId.toString(),
    name: name || user.username || `id${user.telegramId.toString()}`,
    username: user.username,
    avatarUrl: user.avatarUrl,
    email: user.email,
    notificationsEnabled: user.notificationsEnabled,
    balance: balance.balance.toString(),
    reserved: balance.reserved.toString(),
    streak,
    referralCode: user.referralCode,
    createdAt: user.createdAt.toISOString(),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

import { Inject, Injectable } from "@nestjs/common";
import { type AuthResponse, type AuthTokens, UnauthorizedError } from "@kadr/shared";
import { type AppConfig, CONFIG } from "../config";
import { CLOCK, type Clock } from "../users/clock";
import { UsersService } from "../users/users.service";
import {
  verifyMiniAppInitData,
  verifyWidgetLogin,
  type VerifiedTelegramAuth,
  type WidgetLoginPayload,
} from "./telegram-signature";
import { TokenService } from "./token.service";

@Injectable()
export class AuthService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly users: UsersService,
    private readonly tokens: TokenService,
  ) {}

  async loginMiniApp(initData: string): Promise<AuthResponse> {
    return this.login(verifyMiniAppInitData(initData, this.config.BOT_TOKEN, this.clock()));
  }

  async loginWidget(payload: WidgetLoginPayload): Promise<AuthResponse> {
    return this.login(verifyWidgetLogin(payload, this.config.BOT_TOKEN, this.clock()));
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const { tokens } = await this.tokens.rotate(refreshToken);
    return tokens;
  }

  private async login(auth: VerifiedTelegramAuth): Promise<AuthResponse> {
    const { user, isNew } = await this.users.upsertFromTelegram(auth.profile, {
      startParam: auth.startParam,
    });
    if (user.bannedAt) throw new UnauthorizedError({ reason: "banned" });

    await this.users.grantSignupBonusIfNeeded(user);
    const [tokens, me] = await Promise.all([
      this.tokens.issue({ id: user.id, telegramId: user.telegramId }),
      this.users.getMe(user.id),
    ]);
    return { tokens, user: me, isNew };
  }
}

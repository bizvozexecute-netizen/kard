import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ACCESS_TOKEN_TTL_SEC,
  type AuthTokens,
  REFRESH_TOKEN_TTL_SEC,
  UnauthorizedError,
} from "@kadr/shared";
import { type AppConfig, CONFIG } from "../config";
import { RedisService } from "../redis/redis.service";

export interface AuthUser {
  id: string;
  telegramId: bigint;
}

interface AccessPayload {
  sub: string;
  tg: string;
  typ: "access";
}

interface RefreshPayload {
  sub: string;
  tg: string;
  jti: string;
  typ: "refresh";
}

/** Подмножество Redis, нужное для хранения refresh-токенов (удобно подменять в тестах) */
export type RefreshStore = Pick<RedisService, "set" | "getdel">;
export const REFRESH_STORE = Symbol("REFRESH_STORE");

const refreshKey = (jti: string) => `rt:${jti}`;

/**
 * JWT HS256 на JWT_SECRET. Access 15 мин без состояния; refresh 30 дней с jti в Redis:
 * ротация атомарно удаляет старый jti (GETDEL), повторное использование → 401.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(REFRESH_STORE) private readonly store: RefreshStore,
  ) {}

  async issue(user: AuthUser): Promise<AuthTokens> {
    const jti = randomUUID();
    const accessPayload: AccessPayload = {
      sub: user.id,
      tg: user.telegramId.toString(),
      typ: "access",
    };
    const refreshPayload: RefreshPayload = { ...accessPayload, jti, typ: "refresh" };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, { expiresIn: ACCESS_TOKEN_TTL_SEC }),
      this.jwt.signAsync(refreshPayload, { expiresIn: REFRESH_TOKEN_TTL_SEC }),
    ]);
    await this.store.set(refreshKey(jti), user.id, "EX", REFRESH_TOKEN_TTL_SEC);

    return {
      accessToken,
      refreshToken,
      accessExpiresIn: ACCESS_TOKEN_TTL_SEC,
      refreshExpiresIn: REFRESH_TOKEN_TTL_SEC,
    };
  }

  /** Обмен refresh на новую пару. Старый refresh отзывается; повтор → UnauthorizedError. */
  async rotate(refreshToken: string): Promise<{ tokens: AuthTokens; user: AuthUser }> {
    const payload = await this.verify<RefreshPayload>(refreshToken, "refresh");
    if (!payload.jti) throw new UnauthorizedError({ reason: "invalid_token" });

    const owner = await this.store.getdel(refreshKey(payload.jti));
    if (owner !== payload.sub) throw new UnauthorizedError({ reason: "refresh_revoked" });

    const user: AuthUser = { id: payload.sub, telegramId: BigInt(payload.tg) };
    return { tokens: await this.issue(user), user };
  }

  async verifyAccess(token: string): Promise<AuthUser> {
    const payload = await this.verify<AccessPayload>(token, "access");
    return { id: payload.sub, telegramId: BigInt(payload.tg) };
  }

  private async verify<T extends { typ: string; sub: string; tg: string }>(
    token: string,
    typ: T["typ"],
  ): Promise<T> {
    let payload: T;
    try {
      payload = await this.jwt.verifyAsync<T>(token, { secret: this.config.JWT_SECRET });
    } catch (err) {
      const expired = err instanceof Error && err.name === "TokenExpiredError";
      throw new UnauthorizedError({ reason: expired ? "token_expired" : "invalid_token" });
    }
    if (payload.typ !== typ || typeof payload.sub !== "string" || !/^\d+$/.test(payload.tg)) {
      throw new UnauthorizedError({ reason: "invalid_token" });
    }
    return payload;
  }
}

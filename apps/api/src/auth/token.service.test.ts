import "reflect-metadata";
import { JwtService } from "@nestjs/jwt";
import { REFRESH_TOKEN_TTL_SEC, UnauthorizedError } from "@kadr/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { testConfig } from "../test/config.fixture";
import { type RefreshStore, TokenService } from "./token.service";

class MemoryStore implements RefreshStore {
  map = new Map<string, string>();
  ttl = new Map<string, number>();
  // сигнатуры ioredis: set(key, value, "EX", seconds)
  set = (async (key: string, value: string, _mode?: string, seconds?: number) => {
    this.map.set(key, value);
    if (seconds) this.ttl.set(key, seconds);
    return "OK";
  }) as unknown as RefreshStore["set"];
  getdel = (async (key: string) => {
    const v = this.map.get(key) ?? null;
    this.map.delete(key);
    return v;
  }) as unknown as RefreshStore["getdel"];
}

function makeService(store: MemoryStore, secret = testConfig.JWT_SECRET) {
  const jwt = new JwtService({ secret });
  return new TokenService(jwt, { ...testConfig, JWT_SECRET: secret }, store);
}

const user = { id: "user_1", telegramId: 777n };

describe("TokenService", () => {
  let store: MemoryStore;
  let service: TokenService;

  beforeEach(() => {
    store = new MemoryStore();
    service = makeService(store);
  });

  it("issue: пара токенов, refresh jti сохранён с TTL 30 дней", async () => {
    const tokens = await service.issue(user);
    expect(tokens.accessExpiresIn).toBe(900);
    expect(tokens.refreshExpiresIn).toBe(REFRESH_TOKEN_TTL_SEC);
    expect(store.map.size).toBe(1);
    expect([...store.ttl.values()]).toEqual([REFRESH_TOKEN_TTL_SEC]);
    expect(await service.verifyAccess(tokens.accessToken)).toEqual(user);
  });

  it("rotate: выдаёт новую пару, старый refresh второй раз → 401 refresh_revoked", async () => {
    const first = await service.issue(user);
    const rotated = await service.rotate(first.refreshToken);
    expect(rotated.user).toEqual(user);
    expect(rotated.tokens.refreshToken).not.toBe(first.refreshToken);
    expect(store.map.size).toBe(1);

    const err = await service.rotate(first.refreshToken).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect((err as UnauthorizedError).details).toEqual({ reason: "refresh_revoked" });

    // новый refresh работает
    await expect(service.rotate(rotated.tokens.refreshToken)).resolves.toBeTruthy();
  });

  it("access-токен нельзя использовать как refresh и наоборот", async () => {
    const tokens = await service.issue(user);
    await expect(service.rotate(tokens.accessToken)).rejects.toMatchObject({
      details: { reason: "invalid_token" },
    });
    await expect(service.verifyAccess(tokens.refreshToken)).rejects.toMatchObject({
      details: { reason: "invalid_token" },
    });
  });

  it("чужая подпись, мусор и просроченный токен → 401 с причиной", async () => {
    const other = makeService(new MemoryStore(), "another-secret-another-secret-another-secret");
    const foreign = await other.issue(user);
    await expect(service.verifyAccess(foreign.accessToken)).rejects.toMatchObject({
      details: { reason: "invalid_token" },
    });
    await expect(service.verifyAccess("not.a.jwt")).rejects.toMatchObject({
      details: { reason: "invalid_token" },
    });

    const expired = await new JwtService({ secret: testConfig.JWT_SECRET }).signAsync(
      { sub: user.id, tg: "777", typ: "access" },
      { expiresIn: -10 },
    );
    await expect(service.verifyAccess(expired)).rejects.toMatchObject({
      details: { reason: "token_expired" },
    });
  });
});

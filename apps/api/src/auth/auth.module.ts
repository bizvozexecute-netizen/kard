import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerModule } from "@nestjs/throttler";
import { type AppConfig, CONFIG } from "../config";
import { RedisService } from "../redis/redis.service";
import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { RedisThrottlerStorage } from "./redis-throttler.storage";
import { REFRESH_STORE, TokenService } from "./token.service";

/**
 * Аутентификация: Telegram Mini App / Login Widget → JWT (access 15 мин, refresh 30 дней с ротацией).
 * JwtAuthGuard глобальный; публичные ручки помечаются @Public().
 */
@Global()
@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.JWT_SECRET,
        signOptions: { algorithm: "HS256" },
        verifyOptions: { algorithms: ["HS256"] },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ name: "auth", ttl: 60_000, limit: 10 }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    { provide: REFRESH_STORE, useExisting: RedisService },
    TokenService,
    AuthService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [TokenService],
})
export class AuthModule {}

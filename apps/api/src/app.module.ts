import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";
import { ZodValidationPipe } from "nestjs-zod";
import { AuthModule } from "./auth/auth.module";
import { CatalogModule } from "./catalog/catalog.module";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { type AppConfig } from "./config";
import { ConfigModule } from "./config.module";
import { HealthModule } from "./health/health.module";
import { LedgerModule } from "./ledger/ledger.module";
import { LoggerModule } from "./logger/logger.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { UsersModule } from "./users/users.module";

/**
 * Корневой модуль. Глобально: конфиг, логгер, Prisma, Redis, Ledger, JWT-guard,
 * zod-валидация всех DTO и единый формат ошибок.
 */
@Module({})
export class AppModule {
  /** config не передан → читается из env (prod); в тестах передаётся явно. */
  static forRoot(config?: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule,
        PrismaModule,
        RedisModule,
        LedgerModule,
        UsersModule,
        AuthModule,
        CatalogModule,
        HealthModule,
      ],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
    };
  }
}

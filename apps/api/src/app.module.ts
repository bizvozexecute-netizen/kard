import { Module } from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";
import { ZodValidationPipe } from "nestjs-zod";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { ConfigModule } from "./config.module";
import { HealthModule } from "./health/health.module";
import { LoggerModule } from "./logger/logger.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";

/**
 * Корневой модуль. Глобально: конфиг, логгер, Prisma, Redis,
 * zod-валидация всех DTO и единый формат ошибок.
 */
@Module({
  imports: [ConfigModule.forRoot(), LoggerModule, PrismaModule, RedisModule, HealthModule],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}

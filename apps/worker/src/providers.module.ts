import { Global, Module } from "@nestjs/common";
import { EnhancerService, GeminiClient, PrismaTemplateSource } from "@kadr/enhancer";
import { FalProvider, ProviderRouter, RedisCircuitBreaker } from "@kadr/providers";
import { PinoLogger } from "nestjs-pino";
import { CONFIG, type WorkerConfig } from "./config";
import { PrismaService } from "./prisma.service";
import { RedisService } from "./redis.service";

/**
 * DI провайдеров генерации и enhancer'а (ТЗ §7). Потребитель — процессор
 * generations (сессия 6): ProviderRouter.submit/poll и EnhancerService.enhance.
 */
@Global()
@Module({
  providers: [
    RedisService,
    {
      provide: FalProvider,
      useFactory: (config: WorkerConfig) => new FalProvider({ apiKey: config.FAL_KEY }),
      inject: [CONFIG],
    },
    {
      provide: RedisCircuitBreaker,
      useFactory: (redis: RedisService, logger: PinoLogger) =>
        new RedisCircuitBreaker(redis, {}, (event) =>
          logger.warn(event, "provider circuit opened"),
        ),
      inject: [RedisService, PinoLogger],
    },
    {
      provide: ProviderRouter,
      useFactory: (fal: FalProvider, breaker: RedisCircuitBreaker, logger: PinoLogger) =>
        new ProviderRouter({ fal }, breaker, logger),
      inject: [FalProvider, RedisCircuitBreaker, PinoLogger],
    },
    {
      provide: EnhancerService,
      useFactory: (config: WorkerConfig, prisma: PrismaService, logger: PinoLogger) =>
        new EnhancerService(
          new GeminiClient({ apiKey: config.GEMINI_KEY, model: config.GEMINI_MODEL }),
          new PrismaTemplateSource(prisma),
          logger,
        ),
      inject: [CONFIG, PrismaService, PinoLogger],
    },
  ],
  exports: [ProviderRouter, EnhancerService, RedisService],
})
export class ProvidersModule {}

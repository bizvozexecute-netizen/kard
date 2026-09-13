import { type DynamicModule, Global, Module } from "@nestjs/common";
import { type AppConfig, CONFIG, loadConfig } from "./config";

@Global()
@Module({})
export class ConfigModule {
  /** В проде конфиг читается из env; в тестах можно передать готовый объект. */
  static forRoot(config?: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: CONFIG, useFactory: () => config ?? loadConfig() }],
      exports: [CONFIG],
    };
  }
}

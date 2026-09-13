import { type DynamicModule, Global, Module } from "@nestjs/common";
import { CONFIG, loadConfig, type WorkerConfig } from "./config";

@Global()
@Module({})
export class ConfigModule {
  static forRoot(config?: WorkerConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: CONFIG, useFactory: () => config ?? loadConfig() }],
      exports: [CONFIG],
    };
  }
}

import { Module } from "@nestjs/common";
import { LoggerModule as PinoLoggerModule } from "nestjs-pino";
import { CONFIG, type WorkerConfig } from "./config";

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [CONFIG],
      useFactory: (config: WorkerConfig) => ({
        pinoHttp: {
          level: config.LOG_LEVEL,
          customProps: () => ({ app: "worker" }),
          transport:
            config.NODE_ENV === "development"
              ? {
                  target: "pino-pretty",
                  options: { singleLine: true, translateTime: "HH:MM:ss.l" },
                }
              : undefined,
        },
      }),
    }),
  ],
})
export class LoggerModule {}

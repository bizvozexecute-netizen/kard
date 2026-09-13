import { Module } from "@nestjs/common";
import { LoggerModule as PinoLoggerModule } from "nestjs-pino";
import { type AppConfig, CONFIG } from "../config";
import { resolveRequestId } from "../common/request-id";

const HEALTH_PATH = "/v1/health";

/**
 * pino через nestjs-pino: JSON в prod, pretty в dev, request-id на каждом запросе,
 * секреты в заголовках вырезаются.
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.LOG_LEVEL,
          genReqId: resolveRequestId,
          redact: {
            paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
            censor: "[redacted]",
          },
          autoLogging: { ignore: (req) => req.url === HEALTH_PATH },
          customLogLevel: (_req, res, err) => {
            if (err || res.statusCode >= 500) return "error";
            if (res.statusCode >= 400) return "warn";
            return "info";
          },
          customProps: () => ({ app: "api" }),
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

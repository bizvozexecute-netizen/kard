import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { LoggerModule } from "nestjs-pino";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigModule } from "../config.module";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { RedisModule } from "../redis/redis.module";
import { RedisService } from "../redis/redis.service";
import { testConfig } from "../test/config.fixture";
import { HealthModule } from "./health.module";
import { probe } from "./health.service";

describe("probe", () => {
  it("up при успехе, down при ошибке", async () => {
    await expect(probe(async () => 1)).resolves.toBe("up");
    await expect(probe(async () => Promise.reject(new Error("x")))).resolves.toBe("down");
  });

  it("down, если проверка не уложилась в таймаут", async () => {
    const never = () => new Promise<void>(() => undefined);
    await expect(probe(never, 20)).resolves.toBe("down");
  });
});

interface Fakes {
  prisma: { $queryRaw: ReturnType<typeof vi.fn> };
  redis: { status: string; connect: ReturnType<typeof vi.fn>; ping: ReturnType<typeof vi.fn> };
}

async function buildApp(fakes: Fakes): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot(testConfig),
      LoggerModule.forRoot({ pinoHttp: { level: "silent" } }),
      PrismaModule,
      RedisModule,
      HealthModule,
    ],
  })
    .overrideProvider(PrismaService)
    .useValue(fakes.prisma)
    .overrideProvider(RedisService)
    .useValue(fakes.redis)
    .compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  app.setGlobalPrefix("v1");
  await app.init();
  return app;
}

function healthyFakes(): Fakes {
  return {
    prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    redis: { status: "ready", connect: vi.fn(), ping: vi.fn().mockResolvedValue("PONG") },
  };
}

describe("GET /v1/health", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("200 ok, когда Postgres и Redis отвечают", async () => {
    app = await buildApp(healthyFakes());
    const res = await request(app.getHttpServer()).get("/v1/health").expect(200);
    expect(res.body).toEqual({ status: "ok", checks: { postgres: "up", redis: "up" } });
  });

  it("503 degraded, когда Redis недоступен", async () => {
    const fakes = healthyFakes();
    fakes.redis.ping.mockRejectedValue(new Error("ECONNREFUSED"));
    app = await buildApp(fakes);
    const res = await request(app.getHttpServer()).get("/v1/health").expect(503);
    expect(res.body).toEqual({ status: "degraded", checks: { postgres: "up", redis: "down" } });
  });

  it("503 degraded, когда Postgres отвечает ошибкой", async () => {
    const fakes = healthyFakes();
    fakes.prisma.$queryRaw.mockRejectedValue(new Error("connection refused"));
    app = await buildApp(fakes);
    const res = await request(app.getHttpServer()).get("/v1/health").expect(503);
    expect(res.body.checks).toEqual({ postgres: "down", redis: "up" });
  });

  it("подключает ленивый Redis-клиент перед ping", async () => {
    const fakes = healthyFakes();
    fakes.redis.status = "wait";
    fakes.redis.connect.mockResolvedValue(undefined);
    app = await buildApp(fakes);
    await request(app.getHttpServer()).get("/v1/health").expect(200);
    expect(fakes.redis.connect).toHaveBeenCalledTimes(1);
  });
});

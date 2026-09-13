import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

export type CheckState = "up" | "down";

export interface HealthReport {
  status: "ok" | "degraded";
  checks: { postgres: CheckState; redis: CheckState };
}

const CHECK_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async check(): Promise<HealthReport> {
    const [postgres, redis] = await Promise.all([this.checkPostgres(), this.checkRedis()]);
    const status = postgres === "up" && redis === "up" ? "ok" : "degraded";
    return { status, checks: { postgres, redis } };
  }

  private async checkPostgres(): Promise<CheckState> {
    return probe(() => this.prisma.$queryRaw`SELECT 1`);
  }

  private async checkRedis(): Promise<CheckState> {
    return probe(async () => {
      if (this.redis.status === "wait") await this.redis.connect();
      const pong = await this.redis.ping();
      if (pong !== "PONG") throw new Error(`unexpected ping reply: ${pong}`);
    });
  }
}

/** up, если fn успела успешно завершиться за timeoutMs; иначе down. Ошибки наружу не выпускает. */
export async function probe(
  fn: () => Promise<unknown>,
  timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<CheckState> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("health check timeout")), timeoutMs);
  });
  try {
    await Promise.race([fn(), timeout]);
    return "up";
  } catch {
    return "down";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

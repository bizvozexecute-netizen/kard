import { EventEmitter } from "node:events";
import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { genChannel, type GenEvent, genEventSchema } from "@kadr/shared";
import Redis from "ioredis";
import { PinoLogger } from "nestjs-pino";
import { type AppConfig, CONFIG } from "../config";

/**
 * Подписка на события генераций из Redis pub/sub (канал gen:{id}).
 * Одно subscriber-соединение на процесс, psubscribe gen:* лениво,
 * раздача — через локальный EventEmitter.
 */
@Injectable()
export class GenerationEventsService implements OnModuleDestroy {
  private readonly emitter = new EventEmitter();
  private subscriber?: Redis;
  private subscribed = false;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(GenerationEventsService.name);
    this.emitter.setMaxListeners(1000);
  }

  /** Возвращает функцию отписки. */
  async subscribe(generationId: string, listener: (event: GenEvent) => void): Promise<() => void> {
    await this.ensureSubscribed();
    const channel = genChannel(generationId);
    this.emitter.on(channel, listener);
    return () => this.emitter.off(channel, listener);
  }

  private async ensureSubscribed(): Promise<void> {
    if (this.subscribed) return;
    this.subscriber = new Redis(this.config.REDIS_URL, { maxRetriesPerRequest: null });
    this.subscriber.on("error", (err) => this.logger.warn({ err }, "events subscriber error"));
    this.subscriber.on("pmessage", (_pattern, channel, message) => {
      try {
        const event = genEventSchema.parse(JSON.parse(message));
        this.emitter.emit(channel, event);
      } catch {
        this.logger.warn({ channel }, "malformed generation event");
      }
    });
    await this.subscriber.psubscribe("gen:*");
    this.subscribed = true;
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit().catch(() => this.subscriber?.disconnect());
  }
}

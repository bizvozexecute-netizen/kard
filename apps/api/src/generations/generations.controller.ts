import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import {
  type GenerationDto,
  type GenEvent,
  isTerminalGenStatus,
  ValidationError,
} from "@kadr/shared";
import type { Response } from "express";
import { CurrentUser } from "../auth/decorators";
import type { AuthUser } from "../auth/token.service";
import { GenerationEventsService } from "./generation-events.service";
import { GenerationsService } from "./generations.service";
import { CreateGenerationDto, ListGenerationsQueryDto } from "./dto";

const SSE_HEARTBEAT_MS = 15_000;

@Controller("generations")
export class GenerationsController {
  constructor(
    private readonly generations: GenerationsService,
    private readonly events: GenerationEventsService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateGenerationDto,
    @Headers("idempotency-key") idemKey: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!idemKey || idemKey.length > 128) {
      throw new ValidationError({ reason: "idempotency_key_header_required" });
    }
    const { response, created } = await this.generations.create(user.id, body, idemKey);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK).json(response);
  }

  @Get(":id")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string): Promise<GenerationDto> {
    return this.generations.get(user.id, id);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListGenerationsQueryDto) {
    return this.generations.list(user.id, query);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthUser, @Param("id") id: string): Promise<void> {
    await this.generations.softDelete(user.id, id);
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: AuthUser, @Param("id") id: string): Promise<GenerationDto> {
    return this.generations.cancel(user.id, id);
  }

  /** SSE: снапшот сразу, далее события из Redis; heartbeat 15 с; закрытие по терминальному статусу. */
  @Get(":id/events")
  async sse(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Res() res: Response,
  ): Promise<void> {
    const snapshot = await this.generations.get(user.id, id); // 404, если чужая/удалённая

    res.status(HttpStatus.OK);
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders();

    const send = (event: GenEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    send({
      id: snapshot.id,
      status: snapshot.status,
      resultUrls: snapshot.resultUrls.length ? snapshot.resultUrls : undefined,
      errorCode: snapshot.errorCode ?? undefined,
      ts: Date.now(),
    });

    if (isTerminalGenStatus(snapshot.status)) {
      res.end();
      return;
    }

    const heartbeat = setInterval(() => res.write(`: hb ${Date.now()}\n\n`), SSE_HEARTBEAT_MS);
    const unsubscribe = await this.events.subscribe(id, (event) => {
      send(event);
      if (isTerminalGenStatus(event.status)) finish();
    });

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    };
    res.on("close", finish);
  }
}

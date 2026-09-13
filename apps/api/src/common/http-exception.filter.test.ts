import "reflect-metadata";
import {
  Controller,
  Get,
  type INestApplication,
  NotFoundException,
  Post,
  Body,
} from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { createZodDto, ZodValidationPipe } from "nestjs-zod";
import { LoggerModule } from "nestjs-pino";
import request from "supertest";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ru } from "../i18n/ru";
import { AppError, NotFoundError } from "./app-error";
import { HttpExceptionFilter } from "./http-exception.filter";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

class EchoDto extends createZodDto(z.object({ name: z.string().min(2), age: z.number().int() })) {}

@Controller("t")
class ThrowingController {
  @Get("app-error")
  appError() {
    throw new AppError("INSUFFICIENT_CREDITS", 402, { missing: 10 });
  }

  @Get("not-found-error")
  notFoundError() {
    throw new NotFoundError({ id: "x" });
  }

  @Get("nest-http")
  nestHttp() {
    throw new NotFoundException("Cannot find it");
  }

  @Get("boom")
  boom() {
    throw new Error("secret internal detail");
  }

  @Post("echo")
  echo(@Body() body: EchoDto) {
    return body;
  }
}

describe("HttpExceptionFilter", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({ pinoHttp: { level: "silent", genReqId: resolveRequestId } }),
      ],
      controllers: [ThrowingController],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.setGlobalPrefix("v1");
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("AppError → статус и код из ошибки, текст из i18n, details как есть", async () => {
    const res = await request(app.getHttpServer()).get("/v1/t/app-error").expect(402);
    expect(res.body).toEqual({
      error: {
        code: "INSUFFICIENT_CREDITS",
        message: ru.errors.INSUFFICIENT_CREDITS,
        details: { missing: 10 },
      },
    });
  });

  it("NotFoundError → 404 NOT_FOUND", async () => {
    const res = await request(app.getHttpServer()).get("/v1/t/not-found-error").expect(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.details).toEqual({ id: "x" });
  });

  it("стандартный HttpException Nest → код по статусу, причина в details", async () => {
    const res = await request(app.getHttpServer()).get("/v1/t/nest-http").expect(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.message).toBe(ru.errors.NOT_FOUND);
    expect(res.body.error.details).toEqual({ reason: "Cannot find it" });
  });

  it("неизвестный маршрут → 404 NOT_FOUND в едином формате + X-Request-Id", async () => {
    const res = await request(app.getHttpServer()).get("/v1/nope").expect(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.headers[REQUEST_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("входящий X-Request-Id возвращается обратно", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/nope")
      .set(REQUEST_ID_HEADER, "client-req-0001")
      .expect(404);
    expect(res.headers[REQUEST_ID_HEADER]).toBe("client-req-0001");
  });

  it("непредвиденная ошибка → 500 INTERNAL_ERROR без утечки текста, с requestId", async () => {
    const res = await request(app.getHttpServer()).get("/v1/t/boom").expect(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(res.body.error.message).toBe(ru.errors.INTERNAL_ERROR);
    expect(JSON.stringify(res.body)).not.toContain("secret internal detail");
    expect(res.body.error.details.requestId).toBe(res.headers[REQUEST_ID_HEADER]);
  });

  it("невалидное тело (zod) → 400 VALIDATION_ERROR с issues", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/t/echo")
      .send({ name: "a", age: 1.5 })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    const paths = res.body.error.details.issues.map((i: { path: string[] }) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["name", "age"]));
  });

  it("валидное тело проходит через ZodValidationPipe", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/t/echo")
      .send({ name: "ok", age: 3 })
      .expect(201);
    expect(res.body).toEqual({ name: "ok", age: 3 });
  });
});

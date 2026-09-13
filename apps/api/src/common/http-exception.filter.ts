import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { type Request, type Response } from "express";
import { type ApiError, type ErrorCode } from "@kadr/shared";
import { ZodValidationException } from "nestjs-zod";
import { PinoLogger } from "nestjs-pino";
import { errorMessage } from "../i18n/ru";
import { AppError } from "./app-error";
import { requestIdOf } from "./request-id";

interface Normalized {
  status: number;
  code: ErrorCode;
  details?: unknown;
  /** Логировать как ошибку сервера (stack в лог) */
  unexpected: boolean;
}

/**
 * Единый формат ошибок API: { error: { code, message, details } }.
 * Тексты — из i18n по коду; сообщение исключения наружу не утекает.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(HttpExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = requestIdOf(req);

    const { status, code, details, unexpected } = this.normalize(exception);

    if (unexpected) {
      this.logger.error({ err: exception, requestId, path: req.url }, "unhandled exception");
    } else if (status >= 500) {
      this.logger.warn({ code, requestId, path: req.url }, "server error response");
    }

    const body: ApiError = {
      error: {
        code,
        message: errorMessage(code),
        details: unexpected ? { requestId } : details,
      },
    };
    if (body.error.details === undefined) delete body.error.details;

    res.status(status).json(body);
  }

  private normalize(exception: unknown): Normalized {
    if (exception instanceof ZodValidationException) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: "VALIDATION_ERROR",
        details: { issues: exception.getZodError().issues },
        unexpected: false,
      };
    }

    if (exception instanceof AppError) {
      return {
        status: exception.status,
        code: exception.code,
        details: exception.details,
        unexpected: false,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        code: codeFromStatus(status),
        details: httpDetails(exception),
        unexpected: status >= 500,
      };
    }

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, code: "INTERNAL_ERROR", unexpected: true };
  }
}

function codeFromStatus(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.NOT_FOUND:
      return "NOT_FOUND";
    case HttpStatus.UNAUTHORIZED:
    case HttpStatus.FORBIDDEN:
      return "UNAUTHORIZED";
    case HttpStatus.TOO_MANY_REQUESTS:
      return "RATE_LIMITED";
    case HttpStatus.SERVICE_UNAVAILABLE:
      return "UPSTREAM_OVERLOAD";
    case HttpStatus.GATEWAY_TIMEOUT:
      return "PROVIDER_TIMEOUT";
    default:
      return status >= 500 ? "INTERNAL_ERROR" : "VALIDATION_ERROR";
  }
}

/** Для стандартных HttpException Nest отдаём техническую причину в details (не как message). */
function httpDetails(exception: HttpException): unknown {
  const response = exception.getResponse();
  if (typeof response === "string") return { reason: response };
  if (response && typeof response === "object") {
    const { message } = response as { message?: unknown };
    if (message !== undefined) return { reason: message };
  }
  return undefined;
}

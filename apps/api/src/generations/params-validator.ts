import { Injectable } from "@nestjs/common";
import { ValidationError } from "@kadr/shared";
import Ajv, { type ValidateFunction } from "ajv";

/**
 * Валидация params генерации по paramsSchema операции (JSON Schema, draft-07).
 * Скомпилированные схемы кэшируются по ключу операции и времени её изменения.
 */
@Injectable()
export class ParamsValidator {
  private readonly ajv = new Ajv({ strict: false, allErrors: true, coerceTypes: false });
  private readonly cache = new Map<string, ValidateFunction>();

  validate(operationKey: string, updatedAt: Date, schema: unknown, params: unknown): void {
    if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return;

    const cacheKey = `${operationKey}:${updatedAt.getTime()}`;
    let fn = this.cache.get(cacheKey);
    if (!fn) {
      try {
        fn = this.ajv.compile(schema as object);
      } catch {
        // битая схема в каталоге — не наказываем пользователя, пропускаем валидацию
        return;
      }
      this.cache.set(cacheKey, fn);
    }

    if (!fn(params)) {
      throw new ValidationError({
        issues: (fn.errors ?? []).map((e) => ({
          path: e.instancePath.replace(/^\//, "").split("/").filter(Boolean),
          message: e.message ?? "invalid",
          keyword: e.keyword,
        })),
      });
    }
  }
}

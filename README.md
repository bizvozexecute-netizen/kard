# Kadr — бэкенд

AI-генератор медиа (Telegram Mini App + web). Правила проекта — в [CLAUDE.md](./CLAUDE.md),
поэтапное ТЗ — в [kadr-claude-code-tz.md](./kadr-claude-code-tz.md).

## Структура

```
apps/api        NestJS 10: REST + SSE + вебхуки            (@kadr/api)
apps/worker     NestJS standalone: BullMQ-процессоры       (@kadr/worker)
apps/bot        grammY-бот                                  (@kadr/bot)
packages/shared zod-схемы, типы, коды ошибок               (@kadr/shared)
packages/db     Prisma-схема, миграции, PrismaClient        (@kadr/db)
packages/ledger единственная точка изменения кредитов       (@kadr/ledger)
packages/test-utils Postgres/Redis для интеграционных тестов (@kadr/test-utils)
spike/          автономный спайк fal.ai (сессия 0), не часть workspace
```

## Быстрый старт

```bash
cp .env.example .env          # заполнить секреты
docker compose up -d          # postgres:16, redis:7, minio (+ бакет kadr)
pnpm install
pnpm migrate                  # prisma migrate dev
pnpm dev                      # api + worker + bot в watch-режиме
curl localhost:3000/v1/health # {"status":"ok","checks":{"postgres":"up","redis":"up"}}
```

Требования: Node 22+, pnpm 10 (`corepack enable`), Docker.

## Команды

| Команда                             | Что делает                                                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                          | api + worker + bot в watch-режиме (turbo)                                                                                                                         |
| `pnpm build`                        | сборка всех пакетов в `dist/`                                                                                                                                     |
| `pnpm test`                         | все тесты (Vitest); интеграционным (`@kadr/ledger`, `@kadr/api`) нужны Postgres и Redis: `TEST_DATABASE_URL=…` и `TEST_REDIS_URL=…` или Docker для Testcontainers |
| `pnpm lint` / `pnpm typecheck`      | ESLint / `tsc --noEmit` по всем пакетам                                                                                                                           |
| `pnpm format` / `pnpm format:check` | Prettier                                                                                                                                                          |
| `pnpm migrate`                      | `prisma migrate dev` в `packages/db`                                                                                                                              |
| `pnpm db:generate`                  | перегенерировать Prisma Client                                                                                                                                    |

Внутри пакета: `pnpm --filter @kadr/api test`, `pnpm --filter @kadr/db exec prisma studio` и т.д.

## Соглашения

- Все DTO/enum'ы — zod в `packages/shared`, импорт на бек и фронт оттуда.
- Ошибки API всегда в формате `{ "error": { "code", "message", "details" } }`;
  коды — `ErrorCode` из `@kadr/shared`, тексты — `apps/api/src/i18n/ru.ts`.
- Каждый ответ API несёт заголовок `X-Request-Id` (принимается входящий или генерируется).
- Конфиг только из env, валидируется zod при старте; при отсутствии переменной процесс падает.
- Миграции только через `pnpm migrate` (`prisma migrate dev`). Исключение по ТЗ §4: CHECK-констрейнты
  `credit_accounts` дописаны в SQL миграции `ledger`.
- Баланс кредитов меняется только через `LedgerService` из `@kadr/ledger` (reserve/commit/release/grant/spendDirect).

## CI

GitHub Actions (`.github/workflows/ci.yml`): install → lint → format:check → build → test.

# Kadr — AI-генератор медиа (Telegram Mini App + web)

## Что это
Сервис генерации изображений/видео/музыки через API-провайдеров (fal.ai).
Пользователи платят внутренними кредитами (1 кредит ≈ 1 ₽). Кредиты
резервируются перед генерацией и списываются только при успехе; при
неудаче — автоматический возврат. Монетизация: пакеты кредитов через ЮKassa.

## Стек
- Монорепо: pnpm workspaces + turborepo
- apps/api — NestJS 10, REST + SSE + вебхуки
- apps/worker — NestJS standalone, BullMQ-процессоры
- apps/bot — grammY
- apps/web, apps/admin — React 18 + Vite (делаются отдельно, не трогать)
- packages/shared — zod-схемы, типы, enum'ы (единственный источник DTO)
- PostgreSQL 16 + Prisma, Redis 7 (BullMQ + кэш), S3-совместимое хранилище
- Тесты: Vitest (unit), Testcontainers для интеграционных

## Железные правила
1. Любое изменение баланса кредитов — ТОЛЬКО через LedgerService
   (reserve/commit/release/grant/spendDirect). Прямые UPDATE credit_accounts
   вне LedgerService запрещены. Ревью отклоняется при нарушении.
2. Все DTO и enum'ы — zod в packages/shared, импорт на бек и фронт оттуда.
   Дублирование типов запрещено.
3. Все внешние HTTP-вызовы (fal, ЮKassa, Telegram, LLM) — с явным таймаутом,
   ретраями и через модуль-адаптер. Прямые fetch из бизнес-логики запрещены.
4. Тексты для пользователя — только из apps/api/src/i18n/ru.ts (ключи).
5. Деньги и кредиты в БД — BIGINT (копейки/целые кредиты). Никаких float.
6. Каждая мутация с внешним эффектом идемпотентна (Idempotency-Key или
   уникальный ключ провайдера).
7. Миграции — только через prisma migrate dev, руками SQL не править.
8. Секреты — только из env (zod-валидация конфига при старте, падать при
   отсутствии переменной).

## Команды
pnpm dev            # api+worker+bot в watch-режиме
pnpm test           # все тесты
pnpm migrate        # prisma migrate dev
docker compose up -d  # postgres, redis, minio

## Definition of Done сессии
Тесты зелёные, lint чистый, миграции применяются с нуля на пустой БД,
README модуля обновлён (5-10 строк: что делает, как тестировать).

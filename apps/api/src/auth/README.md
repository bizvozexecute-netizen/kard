# auth

Вход через Telegram Mini App (`POST /v1/auth/telegram-mini-app { initData }`, HMAC по алгоритму
Web Apps, secret = HMAC("WebAppData", BOT_TOKEN)) и Login Widget (`POST /v1/auth/telegram-widget`,
secret = SHA256(BOT_TOKEN)); `auth_date` не старше 3600 с. Успех → `{ tokens, user, isNew }`.

JWT HS256: access 15 мин (без состояния), refresh 30 дней с `jti` в Redis (`rt:<jti>`);
`POST /v1/auth/refresh` ротирует пару, старый refresh отзывается атомарно (GETDEL).
`JwtAuthGuard` глобальный, публичные ручки помечаются `@Public()`, пользователь — `@CurrentUser()`.
Auth-ручки ограничены 10 запросами/мин с IP (`@nestjs/throttler`, хранилище в Redis).

Тесты: юнит `pnpm --filter @kadr/api test:unit` (подписи, токены, base58); интеграционные
`TEST_DATABASE_URL=… TEST_REDIS_URL=… pnpm --filter @kadr/api test:integration` (вход, бонус,
рефералы, ротация, 401/429). Фикстуры подписей — `src/auth/testing/telegram-fixtures.ts`.

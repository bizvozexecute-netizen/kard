# catalog

`GET /v1/catalog` и `GET /v1/packages` — публичные (без JWT). Отдают активные операции
генерации (key, kind, tier, title, priceCredits, paramsSchema, etaSec, sort) и пакеты кредитов
(priceRub в рублях, credits строкой, bonusPct, badge). Внутренние поля `cogsUsdEst` и
`providerChain` наружу не отдаются — они для ProviderRouter (сессия 5) и экономики.

Ответы кэшируются в Redis (`cache:catalog:v1`, `cache:packages:v1`, TTL 60 с); при недоступном
Redis ответ собирается из БД. Инвалидация — `CatalogCache.invalidate(key)`; админ-ручек пока нет,
данные правятся сидом/SQL (сид — в миграции `catalog`).

Тесты: юнит `catalog-cache`/маппинг DTO; интеграционные `apps/api/test/catalog.test.ts`
(сид, порядок, кэш и инвалидация): `TEST_DATABASE_URL=… TEST_REDIS_URL=… pnpm --filter @kadr/api test`.

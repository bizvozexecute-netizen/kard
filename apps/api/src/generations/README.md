# generations

`POST /v1/generations` (заголовок `Idempotency-Key` обязателен): проверка операции и параметров
(paramsSchema операции описывает **полный вход** модели — prompt/imageId + params, валидация ajv),
`prompt XOR presetId` (пресеты появятся позже — пока `presets_not_supported`), cost = priceCredits ×
variants (variants ≤ 4, только IMAGE). Порядок: insert QUEUED → `ledger.reserve` → enqueue BullMQ
(jobId = id генерации, дедуп). Повтор ключа → 200 с той же генерацией; нехватка кредитов → 402,
строка удаляется. `kind` генерации — `OperationKind` (в ТЗ назван GenKind; отдельный enum дублировал
бы тип, правило 2).

Чтение: `GET /:id` (владелец), `GET /?cursor&kind` (без удалённых), `DELETE /:id` (soft),
`POST /:id/cancel` (только QUEUED/MODERATING → CANCELED + release; иначе 409 ILLEGAL_TRANSITION).
`GET /:id/events` — SSE: снапшот, события из Redis pub/sub `gen:{id}`, heartbeat 15 с, закрытие по
терминальному статусу. `resultUrls` — подписанные S3-URL (TTL 24 ч).

Пайплайн исполняет worker (`apps/worker/src/generations/pipeline.ts`); интеграционные тесты —
`apps/api/test/generations.test.ts` и `apps/worker/test/pipeline.test.ts`. E2E с реальным fal —
`scripts/smoke.ts` (env `SMOKE_REAL_FAL=1`).

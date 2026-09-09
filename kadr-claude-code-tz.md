# ТЗ для Claude Code · Kadr, этап 1 (бек-ядро)
**Формат: готовые промпты по сессиям. Одна сессия = один модуль = один PR.**

---

## Как этим пользоваться

1. Создай пустой репозиторий `kadr`, положи в корень файл `CLAUDE.md` из §1 этого документа — до первого запуска Claude Code.
2. Каждую сессию запускай в чистом контексте, вставляй промпт сессии целиком. В конце сессии: `pnpm test` зелёный, миграции применены, коммит.
3. **Сессии 2 (ledger) и 7 (payments) — читай дифф глазами построчно.** Остальные — выборочно.
4. Не давай Claude Code «заодно» делать соседние модули. Если предлагает — отказывайся, это размывает тесты и ревью.
5. Порядок сессий менять нельзя: каждая следующая опирается на предыдущую.

---

## 1. CLAUDE.md (положить в корень репо ДО старта, скопировать как есть)

```markdown
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
```

---

## 2. Сессия 0 — спайк fal.ai (до всякого продукта)

**Цель:** проверить качество/цену/латентность до строительства. Это отдельная папка `spike/`, потом выкидывается.

> **Промпт:**
> Создай в папке `spike/` автономный TypeScript-скрипт (без NestJS, просто tsx) для тестирования fal.ai. Ключ в env `FAL_KEY`.
>
> Скрипт `run.ts` принимает аргументы: `--model` (flux/schnell | flux/dev | kling-video | veo), `--prompt` (текст на русском), `--enhance` (bool), `--n` (число прогонов).
>
> При `--enhance=true` перед генерацией вызывай Gemini Flash (env `GEMINI_KEY`, JSON-mode) с системным промптом: переведи запрос на английский и обогати деталями (свет, композиция, объектив; для видео — движение камеры), верни JSON `{prompt_en, negative_en}`. Таймаут 5 с, при ошибке — использовать исходный текст.
>
> Для каждого прогона выведи в консоль и добавь строку в `spike/results.csv`: timestamp, model, enhance, латентность_мс, статус, цена_из_ответа_fal_если_есть, url результата. Файлы результатов скачивай в `spike/out/`.
>
> Добавь `spike/README.md` с примерами команд. Больше ничего не делай.

**Твоя ручная работа после:** прогнать 10–15 реальных промптов (возьми формулировки, какими пишут обычные люди), сравнить пары enhance on/off, сверить фактическую цену с таблицей маржи. Если COGS видео > 0,9 $ за 5 с со звуком — стоп, пересчитываем прайс.

---

## 3. Сессия 1 — каркас монорепо

> **Промпт:**
> Прочитай CLAUDE.md. Создай каркас монорепо по описанной структуре.
>
> 1. pnpm workspaces + turborepo, TypeScript strict везде, единые eslint+prettier в корне.
> 2. `docker-compose.yml`: postgres:16 (порт 5432), redis:7, minio (+ createbuckets init). Volume'ы именованные.
> 3. `apps/api`: NestJS, глобальный ValidationPipe на zod (nestjs-zod), глобальный exception-фильтр, приводящий любые ошибки к формату `{ error: { code, message, details } }`, healthcheck `GET /v1/health` (проверяет Postgres и Redis), pino-logger с request-id middleware.
> 4. `apps/worker`: NestJS standalone-приложение, поднимает BullMQ Worker на очередь `generation` (пока пустой процессор с логом), graceful shutdown.
> 5. `apps/bot`: grammY, echo `/start`, long polling в dev.
> 6. `packages/shared`: заготовка — `errors.ts` (enum кодов: INSUFFICIENT_CREDITS, MODERATION_BLOCKED, PRICE_CHANGED, PROVIDER_TIMEOUT, PROVIDER_ERROR, NSFW_OUTPUT, UPSTREAM_OVERLOAD, NOT_FOUND, UNAUTHORIZED, RATE_LIMITED), `zod/common.ts` (cursor-пагинация).
> 7. Конфиг: `apps/api/src/config.ts` — zod-схема env (DATABASE_URL, REDIS_URL, S3_*, BOT_TOKEN, JWT_SECRET, FAL_KEY, GEMINI_KEY, YOOKASSA_SHOP_ID, YOOKASSA_SECRET), `.env.example` со всеми ключами.
> 8. Prisma: пустая схема + первая миграция. GitHub Actions: install → lint → build → test.
>
> DoD: `docker compose up -d && pnpm dev` поднимает всё, `curl localhost:3000/v1/health` → ok, бот отвечает на /start.

---

## 4. Сессия 2 — Ledger (ядро, ревью глазами)

> **Промпт:**
> Прочитай CLAUDE.md. Реализуй модуль `ledger` в apps/api (и его переиспользование из worker).
>
> **Prisma-модели (добавь в schema.prisma):**
> ```prisma
> model User {
>   id           String   @id @default(cuid())
>   telegramId   BigInt   @unique
>   firstName    String?
>   username     String?
>   email        String?
>   referredBy   String?
>   bannedAt     DateTime?
>   createdAt    DateTime @default(now())
>   account      CreditAccount?
> }
> model CreditAccount {
>   userId    String  @id
>   balance   BigInt  @default(0)
>   reserved  BigInt  @default(0)
>   updatedAt DateTime @updatedAt
>   user      User @relation(fields:[userId], references:[id])
> }
> model LedgerEntry {
>   id             String   @id @default(cuid())
>   userId         String
>   delta          BigInt              // знак включён
>   type           LedgerType          // PURCHASE SPEND REFUND BONUS DAILY REFERRAL MANUAL
>   refType        String?             // 'generation' | 'payment' | ...
>   refId          String?
>   balanceAfter   BigInt
>   idempotencyKey String?  @unique
>   comment        String?
>   createdAt      DateTime @default(now())
>   @@index([userId, createdAt(sort: Desc)])
> }
> ```
> CHECK-констрейнты `balance >= 0`, `reserved >= 0` добавь raw-SQL в миграцию.
>
> **API LedgerService (все методы — внутри одной interactive transaction Prisma, SERIALIZABLE не нужен — используй атомарные UPDATE с условиями):**
> - `reserve(userId, amount, refType, refId)` — атомарно `UPDATE credit_accounts SET balance=balance-a, reserved=reserved+a WHERE user_id=? AND balance>=a`; 0 строк → throw InsufficientCreditsError(missing). Ledger-запись НЕ создаётся (резерв — не факт траты).
> - `commit(userId, amount, refType, refId, idemKey)` — `reserved-=a` (условие reserved>=a) + LedgerEntry(SPEND, delta=-a, idempotencyKey=idemKey). Повторный вызов с тем же idemKey — no-op, вернуть существующую запись.
> - `release(userId, amount, refType, refId, idemKey)` — `balance+=a, reserved-=a` (условие reserved>=a) + LedgerEntry(REFUND, delta=0? нет: delta=+0) — ВАЖНО: release после reserve без commit не меняет исторической суммы, но запись в ledger делаем с delta=0 и comment='release', чтобы был след. Идемпотентно по ключу.
> - `grant(userId, amount, type: BONUS|DAILY|REFERRAL|PURCHASE|MANUAL, refType, refId, idemKey, comment?)` — `balance+=a` + LedgerEntry(delta=+a). Идемпотентно.
> - `spendDirect(userId, amount, ...)` — для будущих мгновенных списаний, аналогично reserve+commit одним шагом.
> - `getBalance(userId)`, `listEntries(userId, cursor)`.
>
> `balanceAfter` считай из значения после UPDATE (RETURNING).
>
> **Cron-сверка (worker, раз в час):** для каждого юзера с активностью за час: `SUM(delta) по ledger + sum(активных резервов через generations в нетерминальных статусах — пока заглушка 0)` vs `balance`. Расхождение → лог level=fatal + запись в таблицу `ledger_mismatches`.
>
> **Тесты (Vitest + Testcontainers, реальный Postgres) — обязательный список:**
> 1. reserve при достаточном балансе / при нехватке (точное missing).
> 2. 20 параллельных reserve на баланс, которого хватает на 10 → ровно 10 успешных (гонки).
> 3. commit идемпотентен (двойной вызов — одна запись, баланс корректен).
> 4. release идемпотентен; release после commit — ошибка IllegalTransition.
> 5. commit больше зарезервированного — ошибка.
> 6. grant идемпотентен по ключу.
> 7. Сумма ledger + reserved == balance после случайной последовательности из 200 операций (property-тест).
> 8. CHECK-констрейнт не даёт уйти в минус даже прямым SQL.
>
> DoD: покрытие модуля ≥ 95% веток. Никаких экспортов Prisma-клиента для credit_accounts наружу модуля.

---

## 5. Сессия 3 — Auth + Users

> **Промпт:**
> Прочитай CLAUDE.md. Модуль `auth` + `users`.
>
> 1. `POST /v1/auth/telegram-mini-app { initData }`: валидация HMAC-SHA256 по алгоритму Telegram Web Apps (секрет = HMAC("WebAppData", BOT_TOKEN)), проверка auth_date < 3600 с. Парсинг user, start_param (`ref_<code>` → referredBy при создании).
> 2. `POST /v1/auth/telegram-widget {...}`: валидация hash по алгоритму Login Widget (секрет = SHA256(BOT_TOKEN)).
> 3. Создание юзера (upsert по telegramId) + CreditAccount в одной транзакции; новому — `ledger.grant(50, BONUS, 'signup', userId, idemKey='signup:'+userId)`.
> 4. JWT: access 15 мин / refresh 30 дней, `POST /v1/auth/refresh` с ротацией refresh (старый инвалидируется, храним jti в Redis с TTL). Guard `JwtAuthGuard` глобально, публичные ручки — декоратор @Public.
> 5. `GET /v1/me` → { id, tgId, name, avatarUrl?, balance, reserved, streak:{days, todayClaimed}, email, referralCode }. referralCode — короткий (8 симв, base58 от id).
> 6. `PATCH /v1/me { email?, notificationsEnabled? }` — email по zod .email().
> 7. `POST /v1/me/daily-claim`: модели Prisma `DailyClaim(userId,date @@id)` и `Streak(userId, current, best, lastClaimDate)`. Логика: вставка DailyClaim (unique → 409 ALREADY_CLAIMED); стрик: вчера был клейм → current+1, иначе current=1; сумма = min(5 + (current-1)*2, 15)... нет, проще и как в ТЗ: дни 1-6 → 5 кредитов, день 7+ → 15. Начисление через ledger.grant(DAILY, idemKey=`daily:${userId}:${date}`).
> 8. Rate limit: @nestjs/throttler на auth-ручки 10/мин с IP.
>
> Тесты: валидные/протухшие/подделанные initData (сгенерируй фикстуры своим ботом-токеном-заглушкой), upsert не дублирует бонус 50, daily-claim идемпотентен на гонке (2 параллельных запроса → одно начисление), стрик через границу дат (замокай время).

---

## 6. Сессия 4 — Catalog

> **Промпт:**
> Прочитай CLAUDE.md. Модуль `catalog`.
>
> Prisma: `Operation(key @id, kind Enum[IMAGE,VIDEO,AUDIO,EDIT,UPSCALE], tier Enum[DRAFT,STANDARD,PREMIUM], title, priceCredits Int, cogsUsdEst Decimal, providerChain Json, paramsSchema Json, etaSec Int, isActive Bool, sort Int)` и `Package(id, priceRub Int, credits Int, bonusPct Int, badge?, isActive, sort)`.
>
> Сид-миграция (данные из ТЗ): image_draft 5⚡ (fal flux/schnell), image_standard 19⚡ (fal flux/dev), image_premium 35⚡, image_edit 25⚡, upscale_x4 9⚡, video_5s 79⚡ (kling), video_5s_audio 179⚡ (veo), video_10s_premium 790⚡ (sora), music_2min 39⚡. Пакеты: 199/199, 499/549, 999/1150(badge=Популярный), 2490/3000, 4990/6250.
>
> `GET /v1/catalog` и `GET /v1/packages` — публичные, кэш Redis 60 с, инвалидация по ключу при изменении (админ-ручки сделаем позже, пока смена — сидом/SQL). zod-схемы ответов в shared.

---

## 7. Сессия 5 — Providers + Enhancer

> **Промпт:**
> Прочитай CLAUDE.md. Два модуля: `providers` и `enhancer` (оба используются из worker).
>
> **providers:** интерфейс
> ```ts
> interface GenProvider {
>   submit(req: {model:string; prompt:string; negative?:string; image?:Buffer; params:Record<string,unknown>}): Promise<{jobId:string}>
>   poll(jobId:string): Promise<{status:'running'|'succeeded'|'failed'; progress?:number; outputs?:{url:string; mime:string}[]; costUsd?:number; errorCode?:string}>
>   cancel?(jobId:string): Promise<void>
> }
> ```
> Реализация `FalProvider` через @fal-ai/client (queue API: submit + status + result; вебхуки не используем в v1, поллинг из воркера). Таймауты: submit 15 с; общий дедлайн задачи задаёт вызывающий. Маппинг ошибок fal → наши error codes (content policy → NSFW_OUTPUT, 429 → UPSTREAM_OVERLOAD, 5xx/timeout → PROVIDER_ERROR/PROVIDER_TIMEOUT).
>
> `ProviderRouter`: принимает providerChain из Operation, идёт по цепочке; circuit breaker в Redis: 5 ошибок провайдера за 10 мин → скип звена на 10 мин (ключ `cb:{provider}:{model}`). Health-состояние — в лог.
>
> **enhancer:** `enhance(promptRu, kind, opts): Promise<{promptEn, negativeEn, category} | null>` — вызов Gemini Flash JSON-mode (адаптер с таймаутом 3 с, 1 ретрай), системный промпт храни в `prompt_templates` таблице (Prisma: id, key, version, body, isActive) с сидом версии v1 из ТЗ §9.2. null при любой ошибке (вызывающий использует исходный текст). Юнит-тесты с мок-LLM: валидный JSON, битый JSON, таймаут.

---

## 8. Сессия 6 — Generations (пайплайн E2E)

> **Промпт:**
> Прочитай CLAUDE.md. Модуль `generations` — API-часть и процессор в worker.
>
> **Prisma:**
> ```prisma
> model Generation {
>   id             String  @id @default(cuid())
>   userId         String
>   operationKey   String
>   kind           GenKind
>   status         GenStatus @default(QUEUED) // QUEUED MODERATING ENHANCING RUNNING SUCCEEDED FAILED CANCELED
>   promptRaw      String?
>   promptFinal    String?
>   negativePrompt String?
>   presetId       String?
>   presetInputs   Json?
>   inputImageKey  String?
>   params         Json
>   variants       Int      @default(1)
>   costCredits    Int
>   costUsdActual  Decimal?
>   provider       String?
>   model          String?
>   providerJobId  String?
>   resultKeys     String[]
>   errorCode      String?
>   parentId       String?
>   idempotencyKey String   @unique
>   deletedAt      DateTime?
>   createdAt      DateTime @default(now())
>   startedAt      DateTime?
>   finishedAt     DateTime?
>   @@index([userId, createdAt(sort:Desc)])
>   @@index([status])
> }
> ```
>
> **POST /v1/generations** (Idempotency-Key header обязателен):
> 1. Повтор ключа → вернуть существующую (200).
> 2. Валидация: operation активна; params по paramsSchema операции; prompt XOR preset; длина ≤ 1500.
> 3. cost = priceCredits × variants (variants только для IMAGE, ≤4).
> 4. Транзакция: `ledger.reserve(cost, 'generation', id)` → insert Generation(QUEUED) → enqueue BullMQ job {generationId} (очередь `generation`, attempts:1 — ретраи логикой, не BullMQ).
> 5. Ответ 201 { id, status, costCredits, balanceAfterReserve }. 402/422 по кодам.
>
> **Процессор (worker):**
> QUEUED → MODERATING: пока заглушка `moderationCheck() => ok` (модуль модерации — отдельная сессия; интерфейс заведи сейчас). Блок → FAILED(MODERATION_BLOCKED) + release.
> → ENHANCING: если params.enhance !== false и есть promptRaw — enhancer; null-ответ не фейлит.
> → RUNNING: ProviderRouter.submit; поллинг с интервалом 2 с (image) / 5 с (video), дедлайн 90 с / 600 с. Прогресс → publish в Redis pub/sub канал `gen:{id}`.
> → SUCCEEDED: скачать outputs (стрим), положить в S3 `results/{userId}/{id}/{n}.{ext}`, resultKeys; `ledger.commit(idemKey='commit:'+id)`; costUsdActual из ответа либо cogsUsdEst; publish финальный статус; enqueue notification job (очередь `notify`, обработаем в сессии бота).
> → FAILED (таймаут/ошибка после ретраев по цепочке): `ledger.release(idemKey='release:'+id)`, errorCode, publish.
> Падение процессора: BullMQ вернёт job → процессор обязан быть идемпотентным (проверка текущего статуса генерации в начале; RUNNING с providerJobId → продолжить поллинг, не пересабмитить).
>
> **Чтение:** GET /v1/generations/:id (владелец), GET /v1/generations?cursor&kind (без deleted), DELETE (soft), POST /:id/cancel (только QUEUED/MODERATING: статус CANCELED + release).
> **SSE GET /v1/generations/:id/events**: подписка на Redis-канал, heartbeat 15 с, закрытие по терминальному статусу.
> **Storage-модуль:** put/getSignedUrl (TTL 24 ч), lifecycle-правило minio/S3 на `uploads/` 30 дней.
> **POST /v1/uploads** (multipart ≤10 МБ, magic bytes jpg/png/webp, sharp: strip EXIF, ресайз до 2048 по длинной стороне) → { imageId, url }. Prisma Upload как в ТЗ.
>
> **Интеграционные тесты (мок-провайдер вместо fal):** успех коммитит ровно cost; провал возвращает всё; двойной POST с одним ключом — одна генерация и один резерв; падение воркера между submit и poll (симулируй рестарт) не дублирует списание; cancel после RUNNING → 409; SSE доставляет терминальный статус.
>
> DoD: e2e-скрипт `scripts/smoke.ts`: создать юзера → начислить кредиты → сгенерировать image_draft через РЕАЛЬНЫЙ fal (env-флаг) → файл в minio, баланс списан корректно.

---

## 9. Сессия 7 — Payments (ревью глазами)

> **Промпт:**
> Прочитай CLAUDE.md. Модуль `payments` (ЮKassa).
>
> Prisma: `Payment(id, userId, provider='yookassa', providerPaymentId @unique, amountRub Int (копейки!), creditsGranted BigInt, status Enum[PENDING,SUCCEEDED,CANCELED], receiptEmail?, createdAt, paidAt?)`.
>
> 1. `POST /v1/payments/checkout { packageId, source }`: пакет активен; если у юзера нет email — 422 EMAIL_REQUIRED (фронт спросит и повторит; email пишется в профиль). Создание платежа в ЮKassa (идемпотентный Idempotence-Key = наш payment.id): amount, capture:true, confirmation:{type:redirect, return_url: WEB_URL+'/pay/success?pid='}, receipt: {customer:{email}, items:[{description:'Пакет кредитов «'+title+'»', quantity:1, amount, vat_code:1, payment_subject:'service', payment_mode:'full_payment'}]}, metadata:{paymentId, userId}. → { paymentId, confirmationUrl }.
> 2. `POST /v1/webhooks/yookassa`: НЕ доверять телу. По event object.id сделать GET платежа в API ЮKassa; статус succeeded → транзакция: Payment.status (условный UPDATE WHERE status='PENDING' — идемпотентность повторных вебхуков) + `ledger.grant(credits, PURCHASE, 'payment', id, idemKey='pay:'+providerPaymentId)` + если у юзера referredBy — `ledger.grant(floor(credits*0.10), REFERRAL, ...)` пригласившему + запись ReferralEarning. canceled → статус. Всегда 200 при обработке, 500 только на инфраструктурных ошибках (ЮKassa ретраит).
> 3. `GET /v1/payments/:id` — статус для поллинга success-страницей.
> 4. Адаптер ЮKassa — отдельный класс, Basic auth shopId:secret, таймаут 10 с.
>
> Тесты: повторный вебхук не дублирует начисление (главный кейс); вебхук по чужому/несуществующему id — 200 и ничего; реферальное начисление ровно 10% floor; checkout без email — 422; мок API ЮKassa.

---

## 10. Сессия 8 — Bot + Notifications

> **Промпт:**
> Прочитай CLAUDE.md. Модули `notifications` (worker) + apps/bot.
>
> Очередь BullMQ `notify`, джобы: {type:'gen_ready'|'gen_failed'|'low_balance'|'payment_ok'|'referral', userId, payload}. Producer'ы уже есть в generations/payments — подключи.
>
> Бот (grammY, webhook-режим в prod, polling в dev):
> - /start: deep links `ref_*` (сохранить в Redis 24ч, если юзер ещё не в БД — auth подберёт), `paid`, `support`. Ответ: приветствие + inline-кнопка web_app на Mini App.
> - Процессор notify: gen_ready — sendPhoto/sendVideo/sendAudio файлом из S3 (стрим, ≤50 МБ) + кнопка «Открыть в Kadr»; gen_failed — текст с причиной и «кредиты вернули»; low_balance (тригер: после commit баланс < 30 и последний такой пуш > 24 ч назад — ключ в Redis); payment_ok.
> - /support: форвард сообщений юзера в группу ADMIN_CHAT_ID (топик per-user через message_thread_id, мапа в Redis), ответы из группы — юзеру.
> - Все send-вызовы через обёртку с обработкой 429 (retry_after) и 403 (юзер заблокировал бота → notificationsEnabled=false).

---

## 11. Env-переменные (справочно, полный список к сессии 8)

```
DATABASE_URL, REDIS_URL,
S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET, S3_PUBLIC_URL,
JWT_SECRET, BOT_TOKEN, ADMIN_CHAT_ID, WEB_URL, MINIAPP_URL,
FAL_KEY, GEMINI_KEY,
YOOKASSA_SHOP_ID, YOOKASSA_SECRET
```

---

## 12. Что дальше (сессии 9+, промпты напишем после запуска ядра)
9. Модерация v1 (стоп-словарь + LLM-классификатор + post-check NSFW).
10. Metrics: дневной отчёт в служебный TG-канал (выручка, генерации, факт-маржа, брак), prometheus.
11. Admin API + интеграция фронта админки.
12. Пресеты (модель, CRUD, подстановка в enhancer).
13. Деплой: infra/ (nginx, compose prod, GitHub Actions deploy), staging-бот.

**Контрольная точка после сессии 8:** полный цикл руками — вход в Mini App (можно временной страницей-заглушкой) → генерация фото → файл в чате от бота → оплата тестовым магазином ЮKassa → баланс вырос. Только после этого зовём Claude Design интегрировать фронт.

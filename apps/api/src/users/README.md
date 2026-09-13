# users

`UsersService.upsertFromTelegram` — пользователь + кредитный счёт в одной транзакции, профиль
обновляется при каждом входе; `referralCode` — 8 символов base58 от id; `start_param=ref_<code>`
проставляет `referredBy` только при создании. Стартовый бонус 50 кредитов начисляется через
`ledger.grant` с ключом `signup:<id>` и отмечается в `signupBonusGrantedAt` (двойная идемпотентность).

`GET /v1/me` — профиль, баланс/резерв из ledger, стрик; `PATCH /v1/me { email?, notificationsEnabled? }`.

`POST /v1/me/daily-claim` — день = календарная дата **UTC** (`YYYY-MM-DD`). PK `daily_claims(user_id, date)`
исключает двойной клейм; стрик: вчера был клейм → `current + 1`, иначе `1`; дни 1–6 → 5 кредитов,
день 7+ → 15; ключ ledger `daily:<user>:<date>`. Повтор → 409 `ALREADY_CLAIMED` с `nextClaimAt`.
В `/me` `streak.days` = `current`, если последний клейм сегодня или вчера, иначе 0.

Тесты: `test/me.test.ts` (интеграционные, время подменяется через провайдер `CLOCK`).

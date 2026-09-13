# @kadr/ledger

Единственная точка изменения баланса кредитов (правило 1 CLAUDE.md). Любой `UPDATE credit_accounts`
вне этого пакета — нарушение, ревью отклоняется.

**API:** `reserve` (balance → reserved, без записи), `commit` (reserved −, запись SPEND),
`release` (reserved → balance, запись REFUND с delta 0), `grant` (balance +, запись BONUS/DAILY/…),
`spendDirect` (balance −, запись SPEND), `getBalance`, `listEntries` (keyset-курсор),
`ensureAccount`, `reconcileActiveSince` (сверка для cron воркера).

**Гарантии:** атомарные `UPDATE … WHERE условие RETURNING` внутри одной транзакции (гонки решает
блокировка строки), идемпотентность по `idempotencyKey` (повтор возвращает существующую запись,
параллельный дубль откатывается), `CHECK (balance >= 0, reserved >= 0)` в БД.
Инвариант: `SUM(delta) == balance + reserved`.

**Тесты** (Vitest, реальный Postgres, покрытие веток ≥ 95%):

```bash
TEST_DATABASE_URL=postgresql://kadr:kadr@localhost:5432/kadr_test pnpm --filter @kadr/ledger test
# без переменной поднимается Testcontainers postgres:16 (нужен Docker)
```

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('PURCHASE', 'SPEND', 'REFUND', 'BONUS', 'DAILY', 'REFERRAL', 'MANUAL');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "first_name" TEXT,
    "username" TEXT,
    "email" TEXT,
    "referred_by" TEXT,
    "banned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_accounts" (
    "user_id" TEXT NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "reserved" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_accounts_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "delta" BIGINT NOT NULL,
    "type" "LedgerType" NOT NULL,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "balance_after" BIGINT NOT NULL,
    "idempotency_key" TEXT,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_mismatches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expected" BIGINT NOT NULL,
    "balance" BIGINT NOT NULL,
    "reserved" BIGINT NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_mismatches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_idempotency_key_key" ON "ledger_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "ledger_entries_user_id_created_at_idx" ON "ledger_entries"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ledger_entries_ref_type_ref_id_idx" ON "ledger_entries"("ref_type", "ref_id");

-- CreateIndex
CREATE INDEX "ledger_mismatches_user_id_detected_at_idx" ON "ledger_mismatches"("user_id", "detected_at" DESC);

-- AddForeignKey
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Инварианты баланса (ТЗ §4): никогда не уходим в минус даже прямым SQL.
ALTER TABLE "credit_accounts"
  ADD CONSTRAINT "credit_accounts_balance_nonneg" CHECK ("balance" >= 0),
  ADD CONSTRAINT "credit_accounts_reserved_nonneg" CHECK ("reserved" >= 0);

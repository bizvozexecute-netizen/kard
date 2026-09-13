-- CreateEnum
CREATE TYPE "GenStatus" AS ENUM ('QUEUED', 'MODERATING', 'ENHANCING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "generations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "operation_key" TEXT NOT NULL,
    "kind" "OperationKind" NOT NULL,
    "status" "GenStatus" NOT NULL DEFAULT 'QUEUED',
    "prompt_raw" TEXT,
    "prompt_final" TEXT,
    "negative_prompt" TEXT,
    "preset_id" TEXT,
    "preset_inputs" JSONB,
    "input_image_key" TEXT,
    "params" JSONB NOT NULL,
    "variants" INTEGER NOT NULL DEFAULT 1,
    "cost_credits" INTEGER NOT NULL,
    "cost_usd_actual" DECIMAL(10,4),
    "provider" TEXT,
    "model" TEXT,
    "provider_job_id" TEXT,
    "result_keys" TEXT[],
    "error_code" TEXT,
    "parent_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "generations_idempotency_key_key" ON "generations"("idempotency_key");

-- CreateIndex
CREATE INDEX "generations_user_id_created_at_idx" ON "generations"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "generations_status_idx" ON "generations"("status");

-- CreateIndex
CREATE INDEX "uploads_user_id_created_at_idx" ON "uploads"("user_id", "created_at" DESC);

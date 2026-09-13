-- CreateEnum
CREATE TYPE "OperationKind" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'EDIT', 'UPSCALE');

-- CreateEnum
CREATE TYPE "OperationTier" AS ENUM ('DRAFT', 'STANDARD', 'PREMIUM');

-- CreateTable
CREATE TABLE "operations" (
    "key" TEXT NOT NULL,
    "kind" "OperationKind" NOT NULL,
    "tier" "OperationTier" NOT NULL,
    "title" TEXT NOT NULL,
    "price_credits" INTEGER NOT NULL,
    "cogs_usd_est" DECIMAL(10,4) NOT NULL,
    "provider_chain" JSONB NOT NULL,
    "params_schema" JSONB NOT NULL,
    "eta_sec" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operations_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" TEXT NOT NULL,
    "price_rub" INTEGER NOT NULL,
    "credits" BIGINT NOT NULL,
    "bonus_pct" INTEGER NOT NULL DEFAULT 0,
    "badge" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "operations_is_active_sort_idx" ON "operations"("is_active", "sort");

-- CreateIndex
CREATE INDEX "packages_is_active_sort_idx" ON "packages"("is_active", "sort");

-- ---------------------------------------------------------------------------
-- Сид каталога (данные из ТЗ §6). До появления админ-ручек правки — сидом/SQL.
-- ---------------------------------------------------------------------------

INSERT INTO "operations"
  ("key", "kind", "tier", "title", "price_credits", "cogs_usd_est", "provider_chain", "params_schema", "eta_sec", "is_active", "sort", "created_at", "updated_at")
VALUES
  ('image_draft',       'IMAGE',   'DRAFT',    'Изображение — черновик',        5,   0.0030, '[{"provider":"fal","model":"fal-ai/flux/schnell"}]',                              '{"type":"object","properties":{"prompt":{"type":"string","maxLength":1500},"aspect_ratio":{"type":"string","enum":["1:1","4:3","3:4","16:9","9:16"]}},"required":["prompt"]}',   5, true, 10, now(), now()),
  ('image_standard',    'IMAGE',   'STANDARD', 'Изображение',                  19,   0.0250, '[{"provider":"fal","model":"fal-ai/flux/dev"}]',                                  '{"type":"object","properties":{"prompt":{"type":"string","maxLength":1500},"aspect_ratio":{"type":"string","enum":["1:1","4:3","3:4","16:9","9:16"]}},"required":["prompt"]}',  15, true, 20, now(), now()),
  ('image_premium',     'IMAGE',   'PREMIUM',  'Изображение — премиум',        35,   0.0500, '[{"provider":"fal","model":"fal-ai/flux-pro/v1.1-ultra"}]',                       '{"type":"object","properties":{"prompt":{"type":"string","maxLength":1500},"aspect_ratio":{"type":"string","enum":["1:1","4:3","3:4","16:9","9:16"]}},"required":["prompt"]}',  25, true, 30, now(), now()),
  ('image_edit',        'EDIT',    'STANDARD', 'Редактирование изображения',   25,   0.0400, '[{"provider":"fal","model":"fal-ai/flux/dev/image-to-image"}]',                   '{"type":"object","properties":{"prompt":{"type":"string","maxLength":1500},"imageId":{"type":"string"}},"required":["prompt","imageId"]}',                                      20, true, 40, now(), now()),
  ('upscale_x4',        'UPSCALE', 'STANDARD', 'Увеличение ×4',                 9,   0.0100, '[{"provider":"fal","model":"fal-ai/esrgan"}]',                                    '{"type":"object","properties":{"imageId":{"type":"string"}},"required":["imageId"]}',                                                                                           10, true, 50, now(), now()),
  ('video_5s',          'VIDEO',   'STANDARD', 'Видео 5 секунд',               79,   0.3500, '[{"provider":"fal","model":"fal-ai/kling-video/v2.1/standard/text-to-video"}]',   '{"type":"object","properties":{"prompt":{"type":"string","maxLength":1500},"aspect_ratio":{"type":"string","enum":["16:9","9:16","1:1"]}},"required":["prompt"]}',             120, true, 60, now(), now()),
  ('video_5s_audio',    'VIDEO',   'PREMIUM',  'Видео 5 секунд со звуком',    179,   0.7500, '[{"provider":"fal","model":"fal-ai/veo3"}]',                                      '{"type":"object","properties":{"prompt":{"type":"string","maxLength":1500},"aspect_ratio":{"type":"string","enum":["16:9","9:16"]}},"required":["prompt"]}',                   180, true, 70, now(), now()),
  ('video_10s_premium', 'VIDEO',   'PREMIUM',  'Видео 10 секунд — премиум',   790,   3.0000, '[{"provider":"fal","model":"fal-ai/sora"}]',                                      '{"type":"object","properties":{"prompt":{"type":"string","maxLength":1500},"aspect_ratio":{"type":"string","enum":["16:9","9:16"]}},"required":["prompt"]}',                   300, true, 80, now(), now()),
  ('music_2min',        'AUDIO',   'STANDARD', 'Музыка до 2 минут',            39,   0.0800, '[{"provider":"fal","model":"fal-ai/lyria2"}]',                                    '{"type":"object","properties":{"prompt":{"type":"string","maxLength":1500},"duration_sec":{"type":"integer","minimum":30,"maximum":120}},"required":["prompt"]}',               60, true, 90, now(), now());

INSERT INTO "packages"
  ("id", "price_rub", "credits", "bonus_pct", "badge", "is_active", "sort", "created_at", "updated_at")
VALUES
  ('pkg_199',  199,  199,  0, NULL,          true, 10, now(), now()),
  ('pkg_499',  499,  549, 10, NULL,          true, 20, now(), now()),
  ('pkg_999',  999, 1150, 15, 'Популярный',  true, 30, now(), now()),
  ('pkg_2490', 2490, 3000, 20, NULL,         true, 40, now(), now()),
  ('pkg_4990', 4990, 6250, 25, NULL,         true, 50, now(), now());

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prompt_templates_key_is_active_idx" ON "prompt_templates"("key", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_templates_key_version_key" ON "prompt_templates"("key", "version");

-- Сид: системный промпт enhancer v1 (перевод RU→EN + обогащение деталями; JSON-режим).
INSERT INTO "prompt_templates" ("id", "key", "version", "body", "is_active", "created_at")
VALUES (
  'ptpl_enhancer_system_v1',
  'enhancer_system',
  1,
  'You are a prompt engineer for AI image, video and music generation.' || E'\n' ||
  'The user writes a request in Russian. Translate it into English and enrich it with concrete' || E'\n' ||
  'visual details: lighting, composition, lens/focal length, style and mood. For video requests' || E'\n' ||
  'also describe camera movement. For music requests describe genre, tempo, instruments and mood.' || E'\n' ||
  'Keep the user''s intent intact, do not add unrelated objects or people.' || E'\n' ||
  'Also classify the request into a short category: one of "people", "landscape", "animals",' || E'\n' ||
  '"product", "architecture", "abstract", "music", "other".' || E'\n' ||
  'Return ONLY JSON of the form {"prompt_en": string, "negative_en": string, "category": string},' || E'\n' ||
  'where negative_en lists things to avoid (artifacts, blur, extra limbs, text, watermark, etc.).',
  true,
  now()
);

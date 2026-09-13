# spike/ — проверка fal.ai (сессия 0)

Временная папка, не часть продукта. Цель: до строительства ядра проверить
качество, цену и латентность генерации через fal.ai и эффект обогащения
промпта через Gemini Flash. После спайка папка выкидывается.

## Установка

```bash
cd spike
pnpm install
```

Требуется Node 22+ и pnpm.

## Переменные окружения

| Переменная | Назначение |
|---|---|
| `FAL_KEY` | ключ fal.ai, обязателен |
| `GEMINI_KEY` | ключ Gemini, нужен при `--enhance=true` (без него enhance пропускается с предупреждением) |
| `GEMINI_MODEL` | модель Gemini, по умолчанию `gemini-2.5-flash` |
| `FAL_ENDPOINT_FLUX_SCHNELL`, `FAL_ENDPOINT_FLUX_DEV`, `FAL_ENDPOINT_KLING_VIDEO`, `FAL_ENDPOINT_VEO` | переопределить endpoint fal, если идентификатор модели сменился |

Endpoint'ы по умолчанию:

| `--model` | endpoint fal | тип |
|---|---|---|
| `flux/schnell` | `fal-ai/flux/schnell` | image |
| `flux/dev` | `fal-ai/flux/dev` | image |
| `kling-video` | `fal-ai/kling-video/v2.1/standard/text-to-video` | video, 5 с |
| `veo` | `fal-ai/veo3` | video, 8 с, со звуком |

## Примеры

```bash
export FAL_KEY=...
export GEMINI_KEY=...

# картинка, быстрая модель, без обогащения
pnpm run run -- --model flux/schnell --prompt "рыжий кот в очках читает книгу у окна"

# та же картинка с обогащением через Gemini, 3 прогона для сравнения
pnpm run run -- --model flux/schnell --prompt "рыжий кот в очках читает книгу у окна" --enhance=true --n 3

# качественная картинка
pnpm run run -- --model flux/dev --prompt "новогодняя ёлка в гостиной, вечер" --enhance=true

# видео Kling, 5 с
pnpm run run -- --model kling-video --prompt "девушка идёт по осеннему парку" --enhance=true

# видео Veo со звуком
pnpm run run -- --model veo --prompt "волны разбиваются о скалы на закате" --enhance=true

# справка
pnpm run run -- --help
```

Пара «enhance on/off» для одного промпта — это два запуска с одинаковым
`--prompt` и разным `--enhance`.

## Результаты

- `results.csv` — по строке на каждый прогон:
  `timestamp,model,enhance,latency_ms,status,price,url`.
  `enhance` — применилось ли обогащение фактически (при ошибке Gemini будет `false`).
  `price` заполняется только если fal вернул цену в ответе; обычно пусто,
  фактическую стоимость смотрите в биллинге fal.ai.
- `out/` — скачанные файлы `<timestamp>-<model>-<i>.<ext>` (в git не попадают).
- В консоль дополнительно печатается `inference_time` из метрик fal, обогащённый
  промпт и негатив.

Если Gemini не ответил за 5 с или вернул невалидный JSON, генерация идёт
с исходным русским текстом, об этом пишется предупреждение.

## Ручная часть после скрипта

Прогнать 10–15 реальных промптов формулировками обычных людей, сравнить
пары enhance on/off, сверить фактическую цену из биллинга fal с таблицей
маржи. Если COGS видео выше 0,9 $ за 5 с со звуком — стоп, пересчитываем прайс.

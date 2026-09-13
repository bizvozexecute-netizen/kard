import { refreshSchema, telegramMiniAppAuthSchema, telegramWidgetAuthSchema } from "@kadr/shared";
import { createZodDto } from "nestjs-zod";

export class TelegramMiniAppAuthDto extends createZodDto(telegramMiniAppAuthSchema) {}
export class TelegramWidgetAuthDto extends createZodDto(telegramWidgetAuthSchema) {}
export class RefreshDto extends createZodDto(refreshSchema) {}

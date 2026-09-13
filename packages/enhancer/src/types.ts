/** Результат обогащения промпта. null от enhance() = использовать исходный текст. */
export interface EnhanceResult {
  promptEn: string;
  negativeEn: string;
  /** Категория запроса (people/landscape/…): пригодится модерации и аналитике */
  category: string;
}

export type MediaKind = "image" | "video" | "audio";

export interface EnhanceOptions {
  /** Переопределение таймаута на весь вызов LLM (мс) */
  timeoutMs?: number;
}

export interface LlmJsonOptions {
  timeoutMs?: number;
}

/** LLM-клиент, возвращающий строку с JSON (адаптер — правило 3 CLAUDE.md). */
export interface LlmJsonClient {
  generateJson(system: string, user: string, opts?: LlmJsonOptions): Promise<string>;
}

/** Источник системных промптов (таблица prompt_templates). */
export interface TemplateSource {
  getActiveBody(key: string): Promise<string | null>;
}

export interface EnhancerLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

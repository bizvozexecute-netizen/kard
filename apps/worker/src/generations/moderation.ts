export type ModerationVerdict = { ok: true } | { ok: false; reason: string };

/** Интерфейс модерации промпта. Реальный модуль — отдельная сессия (ТЗ §8: пока заглушка). */
export interface ModerationService {
  check(text: string): Promise<ModerationVerdict>;
}

export const MODERATION = Symbol("MODERATION");

export class AlwaysOkModeration implements ModerationService {
  async check(): Promise<ModerationVerdict> {
    return { ok: true };
  }
}

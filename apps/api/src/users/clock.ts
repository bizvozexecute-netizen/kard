/** Источник времени (подменяется в тестах стрика). */
export const CLOCK = Symbol("CLOCK");
export type Clock = () => Date;
export const systemClock: Clock = () => new Date();

/** Календарный день UTC в формате YYYY-MM-DD */
export function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return utcDateString(d);
}

/** Начало следующего дня UTC */
export function nextUtcMidnight(d: Date): Date {
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  return next;
}

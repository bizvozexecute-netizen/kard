import type { BreakerStore } from "../src";

/** In-memory реализация BreakerStore (TTL упрощён: expire хранится, но не тикает). */
export class FakeStore implements BreakerStore {
  map = new Map<string, string>();
  ttl = new Map<string, number>();

  async incr(key: string): Promise<number> {
    const next = Number(this.map.get(key) ?? "0") + 1;
    this.map.set(key, String(next));
    return next;
  }
  async expire(key: string, seconds: number): Promise<number> {
    this.ttl.set(key, seconds);
    return 1;
  }
  async exists(key: string): Promise<number> {
    return this.map.has(key) ? 1 : 0;
  }
  async set(key: string, value: string, _mode: "EX", seconds: number): Promise<"OK"> {
    this.map.set(key, value);
    this.ttl.set(key, seconds);
    return "OK";
  }
  async del(key: string): Promise<number> {
    const existed = this.map.delete(key);
    this.ttl.delete(key);
    return existed ? 1 : 0;
  }
}

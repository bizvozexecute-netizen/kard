import fc from "fast-check";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  IllegalTransitionError,
  InsufficientCreditsError,
  InsufficientReservedError,
} from "../src";
import { createUser, disconnect, ledger, ledgerSum, ref, resetDb } from "./helpers";

type Op =
  | { kind: "grant"; amount: number }
  | { kind: "reserve"; amount: number }
  | { kind: "commit"; pick: number }
  | { kind: "release"; pick: number }
  | { kind: "spendDirect"; amount: number }
  | { kind: "commitAfterRelease"; pick: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant("grant" as const), amount: fc.integer({ min: 1, max: 60 }) }),
  fc.record({ kind: fc.constant("reserve" as const), amount: fc.integer({ min: 1, max: 40 }) }),
  fc.record({ kind: fc.constant("commit" as const), pick: fc.nat() }),
  fc.record({ kind: fc.constant("release" as const), pick: fc.nat() }),
  fc.record({ kind: fc.constant("spendDirect" as const), amount: fc.integer({ min: 1, max: 30 }) }),
  fc.record({ kind: fc.constant("commitAfterRelease" as const), pick: fc.nat() }),
);

/** Эталонная модель счёта */
class Model {
  balance = 0n;
  reserved = 0n;
  sum = 0n;
  open = new Map<string, bigint>();
  released = new Set<string>();
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await disconnect();
});

describe("property: последовательность из 200 операций", () => {
  it("после каждой операции SUM(delta) == balance + reserved и БД совпадает с моделью", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 200, maxLength: 200 }), async (ops) => {
        await resetDb();
        const userId = await createUser(0n);
        const svc = ledger();
        const m = new Model();
        let seq = 0;

        for (const op of ops) {
          seq += 1;
          const key = `k${seq}`;
          switch (op.kind) {
            case "grant": {
              const a = BigInt(op.amount);
              await svc.grant(userId, a, "BONUS", ref(key, "bonus"), key);
              m.balance += a;
              m.sum += a;
              break;
            }
            case "reserve": {
              const a = BigInt(op.amount);
              const id = `r${seq}`;
              if (m.balance >= a) {
                await svc.reserve(userId, a, ref(id));
                m.balance -= a;
                m.reserved += a;
                m.open.set(id, a);
              } else {
                const err = await svc.reserve(userId, a, ref(id)).catch((e: unknown) => e);
                expect(err).toBeInstanceOf(InsufficientCreditsError);
                expect((err as InsufficientCreditsError).missing).toBe(a - m.balance);
              }
              break;
            }
            case "commit": {
              const id = pickOpen(m, op.pick);
              if (!id) break;
              const a = m.open.get(id)!;
              await svc.commit(userId, a, ref(id), `commit:${id}`);
              // повтор — no-op
              await svc.commit(userId, a, ref(id), `commit:${id}`);
              m.reserved -= a;
              m.sum -= a;
              m.open.delete(id);
              break;
            }
            case "release": {
              const id = pickOpen(m, op.pick);
              if (!id) break;
              const a = m.open.get(id)!;
              await svc.release(userId, a, ref(id), `release:${id}`);
              m.balance += a;
              m.reserved -= a;
              m.open.delete(id);
              m.released.add(id);
              break;
            }
            case "spendDirect": {
              const a = BigInt(op.amount);
              if (m.balance >= a) {
                await svc.spendDirect(userId, a, ref(key, "upscale"), key);
                m.balance -= a;
                m.sum -= a;
              } else {
                await expect(
                  svc.spendDirect(userId, a, ref(key, "upscale"), key),
                ).rejects.toBeInstanceOf(InsufficientCreditsError);
              }
              break;
            }
            case "commitAfterRelease": {
              const ids = [...m.released];
              const id = ids.length ? ids[op.pick % ids.length]! : undefined;
              if (!id) break;
              const err = await svc
                .commit(userId, 1n, ref(id), `late:${id}`)
                .catch((e: unknown) => e);
              expect(
                err instanceof IllegalTransitionError || err instanceof InsufficientReservedError,
              ).toBe(true);
              break;
            }
          }

          const db = await svc.getBalance(userId);
          expect(db).toEqual({ balance: m.balance, reserved: m.reserved });
          expect(db.balance).toBeGreaterThanOrEqual(0n);
          expect(db.reserved).toBeGreaterThanOrEqual(0n);
          expect(await ledgerSum(userId)).toBe(m.sum);
          expect(m.sum).toBe(m.balance + m.reserved);
        }
      }),
      { numRuns: 3, endOnFailure: true },
    );
  });
});

function pickOpen(m: Model, pick: number): string | undefined {
  const ids = [...m.open.keys()];
  return ids.length ? ids[pick % ids.length] : undefined;
}

import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";
import { processLedgerReconcile } from "./ledger-reconcile.processor";

function fakeLogger() {
  return { info: vi.fn(), fatal: vi.fn() } as unknown as PinoLogger & {
    info: ReturnType<typeof vi.fn>;
    fatal: ReturnType<typeof vi.fn>;
  };
}

describe("processLedgerReconcile", () => {
  it("вызывает сверку за окно и логирует ok без расхождений", async () => {
    const reconcileActiveSince = vi.fn().mockResolvedValue([]);
    const logger = fakeLogger();
    const now = new Date("2026-01-01T12:00:00Z");

    const result = await processLedgerReconcile(
      { windowMs: 3_600_000 },
      { reconcileActiveSince },
      logger,
      now,
    );

    expect(result).toEqual([]);
    expect(reconcileActiveSince).toHaveBeenCalledWith(new Date("2026-01-01T11:00:00Z"));
    expect(logger.info).toHaveBeenCalledWith(expect.anything(), "ledger reconcile ok");
    expect(logger.fatal).not.toHaveBeenCalled();
  });

  it("каждое расхождение логирует уровнем fatal с суммами строками", async () => {
    const mismatch = { userId: "u1", expected: 100n, balance: 90n, reserved: 5n };
    const reconcileActiveSince = vi.fn().mockResolvedValue([mismatch]);
    const logger = fakeLogger();

    const result = await processLedgerReconcile(
      { windowMs: 60_000 },
      { reconcileActiveSince },
      logger,
    );

    expect(result).toEqual([mismatch]);
    expect(logger.fatal).toHaveBeenCalledTimes(1);
    expect(logger.fatal).toHaveBeenCalledWith(
      { userId: "u1", expected: "100", balance: "90", reserved: "5", diff: "-5" },
      "ledger mismatch detected",
    );
  });
});

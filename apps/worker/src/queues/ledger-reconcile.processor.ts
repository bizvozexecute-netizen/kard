import type { LedgerService, Mismatch } from "@kadr/ledger";
import type { PinoLogger } from "nestjs-pino";

export interface LedgerReconcileJobData {
  /** Размер окна активности, мс */
  windowMs: number;
}

/**
 * Сверка журнала с балансами за окно активности. Расхождение — событие уровня fatal:
 * его быть не должно, это сигнал о баге или ручном вмешательстве в БД.
 */
export async function processLedgerReconcile(
  data: LedgerReconcileJobData,
  ledger: Pick<LedgerService, "reconcileActiveSince">,
  logger: PinoLogger,
  now: Date = new Date(),
): Promise<Mismatch[]> {
  const since = new Date(now.getTime() - data.windowMs);
  const mismatches = await ledger.reconcileActiveSince(since);

  if (mismatches.length === 0) {
    logger.info({ since }, "ledger reconcile ok");
    return mismatches;
  }

  for (const m of mismatches) {
    logger.fatal(
      {
        userId: m.userId,
        expected: m.expected.toString(),
        balance: m.balance.toString(),
        reserved: m.reserved.toString(),
        diff: (m.balance + m.reserved - m.expected).toString(),
      },
      "ledger mismatch detected",
    );
  }
  return mismatches;
}

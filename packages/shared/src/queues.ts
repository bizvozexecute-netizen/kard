/** Имена очередей BullMQ. Продюсеры (api) и консьюмеры (worker) берут их отсюда. */
export const QUEUE = {
  GENERATION: "generation",
  NOTIFY: "notify",
  /** Периодическая сверка ledger (worker, раз в час) */
  LEDGER_RECONCILE: "ledger-reconcile",
} as const;
export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

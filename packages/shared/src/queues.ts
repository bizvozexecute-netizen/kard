/** Имена очередей BullMQ. Продюсеры (api) и консьюмеры (worker) берут их отсюда. */
export const QUEUE = {
  GENERATION: "generation",
  NOTIFY: "notify",
} as const;
export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

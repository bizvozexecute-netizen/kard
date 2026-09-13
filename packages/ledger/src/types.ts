import type { LedgerEntry } from "@kadr/db";
import type { GrantType } from "@kadr/shared";

export type { LedgerEntry };
export type { GrantType };

export interface Balance {
  balance: bigint;
  reserved: bigint;
}

/** Ссылка на сущность, ради которой двигаются кредиты: ('generation', id), ('payment', id)… */
export interface Ref {
  refType: string;
  refId: string;
}

export interface ListEntriesParams {
  cursor?: string;
  limit: number;
}

export interface ListEntriesResult {
  items: LedgerEntry[];
  nextCursor: string | null;
}

export interface Mismatch {
  userId: string;
  /** SUM(delta) по журналу */
  expected: bigint;
  balance: bigint;
  reserved: bigint;
}

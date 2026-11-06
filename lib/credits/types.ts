/**
 * Credits are integers, counted here and nowhere else (POLICY 3.1, 5.2). Costs per level come from
 * lib/config (CREDIT_COST_BY_LEVEL); this port only moves integer amounts atomically.
 */
export interface CreditsPort {
  /**
   * Atomically takes `cost` credits (a positive integer). Returns false and takes nothing if the
   * balance would go below zero (C2). In Postgres this is one conditional UPDATE inside a transaction.
   */
  reserve(userId: string, cost: number): Promise<boolean>;
  /** Gives back a reservation when the hint failed, fell back or was a free cache hit (C3). */
  release(userId: string, cost: number): Promise<void>;
  /** Current balance (0 for a user with no credits row). */
  balance(userId: string): Promise<number>;
}

export function assertCost(cost: number): void {
  if (!Number.isInteger(cost) || cost <= 0)
    throw new RangeError("credit amount must be a positive integer");
}

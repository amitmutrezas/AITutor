/**
 * Credits are integers, counted here and nowhere else (POLICY 3.1, 5.2). Costs per level come from
 * lib/config (CREDIT_COST_BY_LEVEL); this port only moves integer amounts atomically.
 *
 * Lifecycle of a paid hint (C2, C3): reserve -> model call -> either settle (the charge stands and the
 * hash-only hint log row is written in the same transaction) or release (a failed hint is not charged).
 * A reservation that is neither settled nor released is released by reconcile.
 */
export interface Reservation {
  id: string;
}

/** What settle records. There is deliberately no field that can carry learner code (N3). */
export interface SettleEntry {
  exerciseId: string;
  level: number;
  /** sha256 of the learner code. */
  codeHash: string;
  tokensIn: number;
  tokensOut: number;
  fallback: boolean;
}

export interface CreditsPort {
  /**
   * Atomically takes `cost` credits (a positive integer). Returns null (and takes nothing) if the
   * balance would go below zero (C2). Stale reservations of this user are reconciled first.
   */
  reserve(userId: string, cost: number): Promise<Reservation | null>;
  /**
   * Gives back a reservation. Idempotent: true only the first time. Throws if the database call fails,
   * in which case the learner is still debited until the caller retries or reconcile runs.
   */
  release(reservationId: string): Promise<boolean>;
  /**
   * One transaction: writes the hint log row and marks the reservation settled. Returns false (nothing
   * written) if the reservation was already released. Throws, with nothing written, on failure.
   */
  settle(reservationId: string, entry: SettleEntry): Promise<boolean>;
  /** Releases every reservation still open after the configured timeout. Safe to call any time (cron). */
  reconcile(): Promise<number>;
  /** Current balance (0 for a user with no credits row). */
  balance(userId: string): Promise<number>;
}

export function assertCost(cost: number): void {
  if (!Number.isInteger(cost) || cost <= 0)
    throw new RangeError("credit amount must be a positive integer");
}

import { assertCost, type CreditsPort } from "./types";

/**
 * In-memory fake of CreditsPort for unit tests. reserve is one synchronous check-and-decrement,
 * which models the single conditional UPDATE the Postgres function runs under a row lock.
 */
export class InMemoryCredits implements CreditsPort {
  readonly balances = new Map<string, number>();
  readonly ledger: { userId: string; delta: number; reason: string }[] = [];

  constructor(initial: Record<string, number> = {}) {
    for (const [id, n] of Object.entries(initial)) this.balances.set(id, n);
  }

  async reserve(userId: string, cost: number): Promise<boolean> {
    assertCost(cost);
    const bal = this.balances.get(userId) ?? 0;
    if (bal < cost) return false;
    this.balances.set(userId, bal - cost);
    this.ledger.push({ userId, delta: -cost, reason: "hint_reserve" });
    return true;
  }

  async release(userId: string, cost: number): Promise<void> {
    assertCost(cost);
    this.balances.set(userId, (this.balances.get(userId) ?? 0) + cost);
    this.ledger.push({ userId, delta: cost, reason: "hint_release" });
  }

  async balance(userId: string): Promise<number> {
    return this.balances.get(userId) ?? 0;
  }

  /** Test helper mirroring credits_reset: sets the balance (renewal, no rollover). */
  reset(userId: string, amount: number, reason = "reset"): void {
    if (!Number.isInteger(amount) || amount < 0)
      throw new RangeError("amount must be a non-negative integer");
    const old = this.balances.get(userId) ?? 0;
    this.balances.set(userId, amount);
    this.ledger.push({ userId, delta: amount - old, reason });
  }
}

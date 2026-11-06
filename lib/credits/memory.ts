import { CREDITS } from "../config";
import { assertCost, type CreditsPort, type Reservation, type SettleEntry } from "./types";

type Status = "reserved" | "settled" | "released" | "expired";
interface Row {
  id: string;
  userId: string;
  cost: number;
  status: Status;
  createdAt: number;
}

export interface InMemoryCreditsOptions {
  now?: () => number;
  timeoutMs?: number;
  /** Receives the hint log row on settle. If it throws, settle changes nothing (atomic). */
  onSettle?: (userId: string, entry: SettleEntry) => void | Promise<void>;
}

/**
 * In-memory fake of CreditsPort for unit tests. reserve is one synchronous check-and-decrement,
 * which models the single conditional UPDATE the Postgres function runs under a row lock.
 */
export class InMemoryCredits implements CreditsPort {
  readonly balances = new Map<string, number>();
  readonly ledger: { userId: string; delta: number; reason: string }[] = [];
  readonly reservations = new Map<string, Row>();
  private seq = 0;
  private now: () => number;
  private timeoutMs: number;

  constructor(
    initial: Record<string, number> = {},
    private opts: InMemoryCreditsOptions = {},
  ) {
    for (const [id, n] of Object.entries(initial)) this.balances.set(id, n);
    this.now = opts.now ?? Date.now;
    this.timeoutMs = opts.timeoutMs ?? CREDITS.reservationTimeoutSeconds * 1000;
  }

  async reserve(userId: string, cost: number): Promise<Reservation | null> {
    assertCost(cost);
    await this.reconcileFor(userId);
    const bal = this.balances.get(userId) ?? 0;
    if (bal < cost) return null;
    this.balances.set(userId, bal - cost);
    const id = `res_${++this.seq}`;
    this.reservations.set(id, { id, userId, cost, status: "reserved", createdAt: this.now() });
    this.ledger.push({ userId, delta: -cost, reason: "hint_reserve" });
    return { id };
  }

  async release(reservationId: string): Promise<boolean> {
    const r = this.reservations.get(reservationId);
    if (!r || r.status !== "reserved") return false;
    r.status = "released";
    this.balances.set(r.userId, (this.balances.get(r.userId) ?? 0) + r.cost);
    this.ledger.push({ userId: r.userId, delta: r.cost, reason: "hint_release" });
    return true;
  }

  async settle(reservationId: string, entry: SettleEntry): Promise<boolean> {
    const r = this.reservations.get(reservationId);
    if (!r || r.status !== "reserved") return false;
    await this.opts.onSettle?.(r.userId, entry); // throws before any state change
    r.status = "settled";
    return true;
  }

  async reconcile(): Promise<number> {
    return this.reconcileFor(undefined);
  }

  private async reconcileFor(userId: string | undefined): Promise<number> {
    let n = 0;
    for (const r of this.reservations.values()) {
      if (r.status !== "reserved" || (userId && r.userId !== userId)) continue;
      if (this.now() - r.createdAt >= this.timeoutMs && (await this.release(r.id))) n++;
    }
    return n;
  }

  async balance(userId: string): Promise<number> {
    return this.balances.get(userId) ?? 0;
  }

  /** Test helper mirroring credits_reset: sets the balance (renewal, no rollover). */
  reset(userId: string, amount: number, reason = "reset"): void {
    if (!Number.isInteger(amount) || amount < 0)
      throw new RangeError("amount must be a non-negative integer");
    // C4: old-cycle reservations are closed without refund, as in credits_reset.
    for (const r of this.reservations.values()) {
      if (r.userId === userId && r.status === "reserved") r.status = "expired";
    }
    const old = this.balances.get(userId) ?? 0;
    this.balances.set(userId, amount);
    this.ledger.push({ userId, delta: amount - old, reason });
  }
}

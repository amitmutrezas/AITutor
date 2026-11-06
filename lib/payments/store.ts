import type { PlanId } from "./plans";

/** pending: checkout started, not paid. cancelled is terminal. */
export type SubscriptionStatus = "pending" | "active" | "halted" | "cancelled";

export type ClaimResult =
  | { kind: "claimed"; claimId: string }
  /**
   * An unpaid or halted subscription for another plan exists at Razorpay. The caller must cancel it
   * there and only then call closeCheckout; until then nothing has changed locally.
   */
  | { kind: "supersede"; rowId: string; razorpaySubscriptionId: string }
  | { kind: "reuse"; razorpaySubscriptionId: string }
  | { kind: "active_exists" }
  | { kind: "in_progress" }
  /** The account is being deleted: no checkout may start. */
  | { kind: "account_deleting" };

/**
 * "unknown_subscription": no row has this Razorpay subscription id yet. The event id is NOT claimed,
 * so a retry after the id is attached is applied (P2). "mismatch": the subscription belongs to another user.
 */
export type ApplyOutcome =
  "duplicate" | "ignored" | "unknown_subscription" | "mismatch" | "stale" | "applied";

export interface ApplyEventInput {
  eventId: string;
  /** "ignore" only claims the event id (events we do not act on, such as payment.failed). */
  kind: "ignore" | "subscription";
  userId?: string;
  planId?: PlanId;
  razorpaySubscriptionId?: string;
  status?: "active" | "halted" | "cancelled";
  /** When set with status "active", the balance is RESET to this integer (C4, no rollover). */
  grantCredits?: number;
  /** The event's own timestamp, used for lifecycle ordering. */
  eventAt?: Date;
}

export interface LiveSubscription {
  razorpaySubscriptionId: string | null;
  status: SubscriptionStatus;
  planId: PlanId;
}

/**
 * Durable payment state (POLICY 3.1, 3.3). `applyEvent` is ONE transaction: it claims the event id
 * (unique), checks the event belongs to the learner's current subscription, applies lifecycle
 * ordering, changes plan/status and resets credits. An error rolls back all of it so a retry works.
 */
export interface PaymentStore {
  /** Idempotent checkout start: at most one live subscription per learner. */
  claimCheckout(userId: string, planId: PlanId): Promise<ClaimResult>;
  /**
   * Stores the Razorpay subscription id on the caller's still-pending claim. Returns FALSE when no row
   * was updated (claim gone or closed, already attached, account being deleted): the caller must treat
   * the new Razorpay subscription as unattached.
   */
  attachSubscription(claimId: string, razorpaySubscriptionId: string): Promise<boolean>;
  /** Releases a claim when Razorpay could not create the subscription. */
  abandonCheckout(claimId: string): Promise<void>;
  /** Closes a superseded row after its Razorpay subscription was cancelled. */
  closeCheckout(rowId: string): Promise<void>;
  applyEvent(input: ApplyEventInput): Promise<ApplyOutcome>;
  liveSubscription(userId: string): Promise<LiveSubscription | null>;
}

export interface MemorySubscription {
  id: string;
  userId: string;
  planId: PlanId;
  status: SubscriptionStatus;
  razorpaySubscriptionId: string | null;
  createdAt: number;
  lastEventAt: number | null;
}

const LIVE: SubscriptionStatus[] = ["pending", "active", "halted"];
const STALE_CLAIM_MS = 2 * 60_000;

/** In-memory fake that mirrors the semantics of the SQL functions in supabase/migrations/0002. */
export class InMemoryPaymentStore implements PaymentStore {
  readonly processed = new Set<string>();
  readonly rows: MemorySubscription[] = [];
  readonly credits = new Map<string, number>();
  /** Users whose account deletion has begun (mirrors profiles.deleting_at). */
  readonly deleting = new Set<string>();
  private seq = 0;

  constructor(private now: () => number = Date.now) {}

  /** The latest subscription row per user (live rows win), keyed by user id. */
  get subscriptions(): Map<string, MemorySubscription> {
    const m = new Map<string, MemorySubscription>();
    for (const r of this.rows) {
      const cur = m.get(r.userId);
      if (!cur || LIVE.includes(r.status) || !LIVE.includes(cur.status)) m.set(r.userId, r);
    }
    return m;
  }

  private live(userId: string) {
    return this.rows.find((r) => r.userId === userId && LIVE.includes(r.status));
  }

  async claimCheckout(userId: string, planId: PlanId): Promise<ClaimResult> {
    if (this.deleting.has(userId)) return { kind: "account_deleting" };
    const row = this.live(userId);
    if (row) {
      if (row.status === "active") return { kind: "active_exists" };
      if (row.status === "pending" && row.planId === planId) {
        if (row.razorpaySubscriptionId) {
          return { kind: "reuse", razorpaySubscriptionId: row.razorpaySubscriptionId };
        }
        if (row.createdAt > this.now() - STALE_CLAIM_MS) return { kind: "in_progress" };
      }
      if (row.razorpaySubscriptionId) {
        return {
          kind: "supersede",
          rowId: row.id,
          razorpaySubscriptionId: row.razorpaySubscriptionId,
        };
      }
      row.status = "cancelled";
    }
    const id = `claim_${++this.seq}`;
    this.rows.push({
      id,
      userId,
      planId,
      status: "pending",
      razorpaySubscriptionId: null,
      createdAt: this.now(),
      lastEventAt: null,
    });
    return { kind: "claimed", claimId: id };
  }

  async attachSubscription(claimId: string, razorpaySubscriptionId: string) {
    const row = this.rows.find((r) => r.id === claimId);
    if (
      !row ||
      this.deleting.has(row.userId) ||
      row.status !== "pending" ||
      row.razorpaySubscriptionId !== null
    ) {
      return false;
    }
    row.razorpaySubscriptionId = razorpaySubscriptionId;
    return true;
  }

  async closeCheckout(rowId: string) {
    const row = this.rows.find((r) => r.id === rowId);
    if (row && (row.status === "pending" || row.status === "halted")) row.status = "cancelled";
  }

  async abandonCheckout(claimId: string) {
    const row = this.rows.find((r) => r.id === claimId);
    if (row && row.status === "pending" && row.razorpaySubscriptionId === null) {
      row.status = "cancelled";
    }
  }

  async applyEvent(input: ApplyEventInput): Promise<ApplyOutcome> {
    if (input.kind === "ignore") {
      if (this.processed.has(input.eventId)) return "duplicate";
      this.processed.add(input.eventId);
      return "ignored";
    }
    // Look the subscription up BEFORE claiming the event id (see ApplyOutcome).
    const row = this.rows.find(
      (r) =>
        r.razorpaySubscriptionId !== null &&
        r.razorpaySubscriptionId === input.razorpaySubscriptionId,
    );
    if (!row) return "unknown_subscription";
    if (this.processed.has(input.eventId)) return "duplicate";
    this.processed.add(input.eventId);
    if (row.userId !== input.userId) return "mismatch";
    if (row.status === "cancelled") return "stale";
    const at = input.eventAt?.getTime() ?? null;
    if (at !== null && row.lastEventAt !== null && at < row.lastEventAt) return "stale";

    row.status = input.status!;
    row.planId = input.planId!;
    if (at !== null) row.lastEventAt = at;
    if (input.status === "active" && input.grantCredits !== undefined) {
      this.credits.set(row.userId, input.grantCredits);
    }
    return "applied";
  }

  async liveSubscription(userId: string): Promise<LiveSubscription | null> {
    const r = this.live(userId);
    return r
      ? { razorpaySubscriptionId: r.razorpaySubscriptionId, status: r.status, planId: r.planId }
      : null;
  }
}

import type { PlanId } from "./plans";
import { PAYMENT_PLANS } from "./plans";

export type SubscriptionStatus = "active" | "cancelled" | "halted";

export interface PaymentStore {
  hasProcessedEvent(eventId: string): Promise<boolean>;
  markProcessed(eventId: string): Promise<void>;
  setSubscription(
    userId: string,
    planId: PlanId,
    status: SubscriptionStatus,
    razorpaySubscriptionId: string,
  ): Promise<void>;
  /** RESETS the balance to the plan's monthly allowance (integer). No rollover (C4). */
  grantMonthlyCredits(userId: string, planId: PlanId): Promise<void>;
}

export interface MemorySubscription {
  planId: PlanId;
  status: SubscriptionStatus;
  razorpaySubscriptionId: string;
}

/** In-memory implementation for tests and local development. */
export class InMemoryPaymentStore implements PaymentStore {
  readonly processed = new Set<string>();
  readonly subscriptions = new Map<string, MemorySubscription>();
  readonly credits = new Map<string, number>();

  async hasProcessedEvent(eventId: string) {
    return this.processed.has(eventId);
  }
  async markProcessed(eventId: string) {
    this.processed.add(eventId);
  }
  async setSubscription(
    userId: string,
    planId: PlanId,
    status: SubscriptionStatus,
    razorpaySubscriptionId: string,
  ) {
    this.subscriptions.set(userId, { planId, status, razorpaySubscriptionId });
  }
  async grantMonthlyCredits(userId: string, planId: PlanId) {
    this.credits.set(userId, PAYMENT_PLANS[planId].monthlyCredits);
  }
}

let defaultStore: PaymentStore | undefined;

/**
 * Returns null in production: the in-memory store is not durable or transactional, so callers
 * must fail closed (generic 503) rather than lose or double-apply money events.
 * TODO(M5): return the Supabase-backed store here. Plan change, credit reset and markProcessed
 * must happen in one database transaction via lib/credits (POLICY 3.1, 3.3).
 */
export function getPaymentStore(): PaymentStore | null {
  if (process.env.NODE_ENV === "production") return null;
  defaultStore ??= new InMemoryPaymentStore();
  return defaultStore;
}

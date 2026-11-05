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
  /** Adds the plan's monthly credits (integer) to the user's balance. */
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
    this.credits.set(
      userId,
      (this.credits.get(userId) ?? 0) + PAYMENT_PLANS[planId].monthlyCredits,
    );
  }
}

let defaultStore: PaymentStore | undefined;

/**
 * TODO(M5): return the Supabase-backed implementation. Plan changes and credit grants must go
 * through lib/credits inside one database transaction together with markProcessed, so a crash
 * cannot grant credits twice (POLICY 3.1, 3.3). Until then, state is in-memory and non-durable.
 */
export function getPaymentStore(): PaymentStore {
  defaultStore ??= new InMemoryPaymentStore();
  return defaultStore;
}

import { z } from "zod";
import { callRpc, type RpcClient } from "../db/rpc";
import { PLAN_IDS } from "./plans";
import type { ApplyOutcome, ClaimResult, LiveSubscription, PaymentStore } from "./store";

const claimResult = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("claimed"), claim_id: z.string() }),
  z.object({
    outcome: z.literal("supersede"),
    row_id: z.string(),
    razorpay_subscription_id: z.string(),
  }),
  z.object({ outcome: z.literal("reuse"), razorpay_subscription_id: z.string() }),
  z.object({ outcome: z.literal("active_exists") }),
  z.object({ outcome: z.literal("in_progress") }),
  z.object({ outcome: z.literal("account_deleting") }),
]);

const applyOutcome = z.enum([
  "duplicate",
  "ignored",
  "unknown_subscription",
  "mismatch",
  "stale",
  "applied",
]);

const liveRow = z
  .object({
    razorpay_subscription_id: z.string().nullable(),
    status: z.enum(["pending", "active", "halted"]),
    plan_id: z.enum(PLAN_IDS),
  })
  .nullable();

/**
 * Postgres-backed PaymentStore. Every method is a single SQL function call, hence a single
 * transaction (see payments_apply_event in supabase/migrations/0002).
 */
export function createSupabasePaymentStore(db: RpcClient): PaymentStore {
  return {
    async claimCheckout(userId, planId): Promise<ClaimResult> {
      const r = await callRpc(
        db,
        "payments_claim_checkout",
        { p_user: userId, p_plan: planId },
        claimResult,
      );
      switch (r.outcome) {
        case "claimed":
          return { kind: "claimed", claimId: r.claim_id };
        case "supersede":
          return {
            kind: "supersede",
            rowId: r.row_id,
            razorpaySubscriptionId: r.razorpay_subscription_id,
          };
        case "reuse":
          return { kind: "reuse", razorpaySubscriptionId: r.razorpay_subscription_id };
        case "active_exists":
          return { kind: "active_exists" };
        case "in_progress":
          return { kind: "in_progress" };
        case "account_deleting":
          return { kind: "account_deleting" };
      }
    },

    attachSubscription(claimId, razorpaySubscriptionId) {
      return callRpc(
        db,
        "payments_attach_subscription",
        { p_claim: claimId, p_razorpay_subscription_id: razorpaySubscriptionId },
        z.boolean(),
      );
    },

    async closeCheckout(rowId) {
      await callRpc(db, "payments_close_checkout", { p_row: rowId }, z.unknown());
    },

    async abandonCheckout(claimId) {
      await callRpc(db, "payments_abandon_checkout", { p_claim: claimId }, z.unknown());
    },

    applyEvent(input): Promise<ApplyOutcome> {
      return callRpc(
        db,
        "payments_apply_event",
        {
          p_event_id: input.eventId,
          p_kind: input.kind,
          p_user: input.userId ?? null,
          p_plan: input.planId ?? null,
          p_razorpay_subscription_id: input.razorpaySubscriptionId ?? null,
          p_status: input.status ?? null,
          p_credits: input.grantCredits ?? null,
          p_event_at: input.eventAt ? input.eventAt.toISOString() : null,
        },
        applyOutcome,
      );
    },

    async liveSubscription(userId): Promise<LiveSubscription | null> {
      const r = await callRpc(db, "payments_live_subscription", { p_user: userId }, liveRow);
      return r
        ? {
            razorpaySubscriptionId: r.razorpay_subscription_id,
            status: r.status,
            planId: r.plan_id,
          }
        : null;
    },
  };
}

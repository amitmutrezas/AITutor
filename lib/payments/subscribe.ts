import { z } from "zod";
import { failed, json, readBody, unavailable } from "../api/http";
import { requireUser } from "../auth/session";
import type { Authenticate } from "../auth/types";
import { PAYMENT_PLANS, PLAN_IDS, razorpayPlanId } from "./plans";
import { cancelRazorpaySubscription, razorpayAuthHeader } from "./razorpay";
import type { PaymentStore } from "./store";

export const subscribeBody = z.strictObject({ planId: z.enum(PLAN_IDS) });

export interface SubscribeDeps {
  keyId: string | undefined;
  keySecret: string | undefined;
  authenticate: Authenticate;
  store: PaymentStore | null;
  env?: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
}

/**
 * Starts a Razorpay subscription checkout. Idempotent: the checkout attempt is claimed in the
 * database BEFORE Razorpay is called, so a double click or a retry reuses the pending checkout and
 * a learner with an active subscription is refused. The client never decides a plan change: only
 * the signature-verified webhook does (P1).
 */
export async function handleSubscribe(request: Request, deps: SubscribeDeps): Promise<Response> {
  const auth = await requireUser(request, deps.authenticate);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  const body = await readBody(request, subscribeBody);
  if (!body.ok) return body.response;
  const planId = body.data.planId;

  const rzpPlan = razorpayPlanId(planId, deps.env);
  if (!deps.keyId || !deps.keySecret || !rzpPlan || !deps.store) return unavailable();
  const { keyId, keySecret, store } = deps;

  let claim;
  try {
    claim = await store.claimCheckout(userId, planId);
  } catch {
    return failed();
  }
  if (claim.kind === "active_exists") {
    return json(409, { error: "You already have an active subscription" });
  }
  if (claim.kind === "in_progress") {
    return json(409, { error: "Checkout is already starting. Try again in a moment" });
  }
  if (claim.kind === "reuse") {
    return json(200, { subscriptionId: claim.razorpaySubscriptionId, keyId, planId });
  }

  if (claim.supersededSubscriptionId) {
    // Best effort: close the unpaid checkout for the other plan so it cannot be paid later by accident.
    await cancelRazorpaySubscription(
      { keyId, keySecret, fetchFn: deps.fetchFn },
      claim.supersededSubscriptionId,
    );
  }

  try {
    const res = await (deps.fetchFn ?? fetch)("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: razorpayAuthHeader(keyId, keySecret),
      },
      body: JSON.stringify({
        plan_id: rzpPlan,
        total_count: PAYMENT_PLANS[planId].totalCount,
        customer_notify: 1,
        notes: { user_id: userId, plan: planId },
      }),
    });
    const data = res.ok ? z.object({ id: z.string().min(1) }).safeParse(await res.json()) : null;
    if (!data?.success) {
      await store.abandonCheckout(claim.claimId);
      return json(502, { error: "Could not start checkout" });
    }
    await store.attachSubscription(claim.claimId, data.data.id);
    return json(200, { subscriptionId: data.data.id, keyId, planId });
  } catch {
    try {
      await store.abandonCheckout(claim.claimId);
    } catch {
      // The claim expires on its own (see payments_claim_checkout), so this is safe to ignore.
    }
    return json(502, { error: "Could not start checkout" });
  }
}

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

  // Ordering rule for this whole file: a Razorpay side effect and a DB write are never assumed to
  // succeed together. Every step below says what is true if the NEXT step fails.
  const rzp = { keyId, keySecret, fetchFn: deps.fetchFn };
  let claim;
  try {
    claim = await store.claimCheckout(userId, planId);
    if (claim.kind === "supersede") {
      // Cancel the old unpaid/halted subscription at Razorpay FIRST. If that fails we stop: the old row
      // is untouched locally and no replacement is created (so there is never a second live subscription).
      if (!(await cancelRazorpaySubscription(rzp, claim.razorpaySubscriptionId))) {
        return json(502, { error: "Could not switch plans right now. Try again in a moment" });
      }
      await store.closeCheckout(claim.rowId);
      claim = await store.claimCheckout(userId, planId);
    }
  } catch {
    return failed();
  }
  if (claim.kind === "account_deleting") {
    return json(409, { error: "Your account is being deleted" });
  }
  if (claim.kind === "active_exists") {
    return json(409, { error: "You already have an active subscription" });
  }
  if (claim.kind === "in_progress" || claim.kind === "supersede") {
    return json(409, { error: "Checkout is already starting. Try again in a moment" });
  }
  if (claim.kind === "reuse") {
    return json(200, { subscriptionId: claim.razorpaySubscriptionId, keyId, planId });
  }

  let created: string;
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
    if (!data?.success) throw new Error("no subscription id");
    created = data.data.id;
  } catch {
    // Razorpay gave us no id, so there is nothing to cancel or match: release the claim.
    try {
      await store.abandonCheckout(claim.claimId);
    } catch {
      // The claim expires on its own (see payments_claim_checkout), so this is safe to ignore.
    }
    return json(502, { error: "Could not start checkout" });
  }

  // Razorpay now has a subscription we must be able to match. Store its id. A thrown error is retried
  // once; a FALSE result (the UPDATE matched no pending claim of ours) is final and takes the same
  // recovery path as a failure.
  let attached = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      attached = await store.attachSubscription(claim.claimId, created);
      break;
    } catch {
      // retry once
    }
  }
  if (attached) return json(200, { subscriptionId: created, keyId, planId });
  // Could not store the id. Cancel the new subscription so it cannot be paid without a record, then
  // release the claim. If the cancel fails too, KEEP the claim (do not abandon) and log the Razorpay id
  // durably so the subscription can be matched or cancelled by hand; webhooks for it are 503-retried.
  if (await cancelRazorpaySubscription(rzp, created)) {
    try {
      await store.abandonCheckout(claim.claimId);
    } catch {
      // expires on its own
    }
  } else {
    console.error(
      JSON.stringify({
        event: "razorpay_subscription_unattached",
        // Loud on purpose: this subscription exists at Razorpay without a matching row.
        userId,
        claimId: claim.claimId,
        razorpaySubscriptionId: created,
      }),
    );
  }
  return json(502, { error: "Could not start checkout" });
}

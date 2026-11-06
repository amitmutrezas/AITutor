import { z } from "zod";
import { failed, json, readBody, unavailable } from "../api/http";
import { requireUser } from "../auth/session";
import type { Authenticate } from "../auth/types";
import { MOCK_SUBSCRIPTION_PREFIX, paymentsMode } from "./mode";
import { PAYMENT_PLANS, PLAN_IDS } from "./plans";
import type { PaymentStore } from "./store";

export const mockBody = z.strictObject({ planId: z.enum(PLAN_IDS) });

export interface MockPaymentsDeps {
  authenticate: Authenticate;
  store: PaymentStore | null;
  env?: Record<string, string | undefined>;
  newId?: () => string;
  now?: () => Date;
}

const isMock = (id: string | null): id is string => !!id && id.startsWith(MOCK_SUBSCRIPTION_PREFIX);

/**
 * Mock checkout, step 1 (P1 in test mode): claim a pending checkout in the database and attach a
 * mock subscription id. Same claim rules as the real route: one live subscription per learner.
 * Nothing is applied yet; only the confirm step changes plan and credits.
 */
export async function handleMockCheckout(
  request: Request,
  deps: MockPaymentsDeps,
): Promise<Response> {
  if (paymentsMode(deps.env) !== "mock" || !deps.store) return unavailable();
  const auth = await requireUser(request, deps.authenticate);
  if (!auth.ok) return auth.response;
  const body = await readBody(request, mockBody);
  if (!body.ok) return body.response;
  const { planId } = body.data;
  const store = deps.store;

  try {
    let claim = await store.claimCheckout(auth.user.id, planId);
    if (claim.kind === "supersede") {
      // Only a mock checkout can be closed locally; a real Razorpay one needs a Razorpay cancel.
      if (!isMock(claim.razorpaySubscriptionId)) {
        return json(409, { error: "Checkout is already in progress" });
      }
      await store.closeCheckout(claim.rowId);
      claim = await store.claimCheckout(auth.user.id, planId);
    }
    switch (claim.kind) {
      case "account_deleting":
        return json(409, { error: "Your account is being deleted" });
      case "active_exists":
        return json(409, { error: "You already have an active subscription" });
      case "in_progress":
      case "supersede":
        return json(409, { error: "Checkout is already starting. Try again in a moment" });
      case "reuse":
        return isMock(claim.razorpaySubscriptionId)
          ? json(200, { planId, mock: true })
          : json(409, { error: "Checkout is already in progress" });
      case "claimed": {
        const id = `${MOCK_SUBSCRIPTION_PREFIX}${(deps.newId ?? (() => crypto.randomUUID()))()}`;
        if (!(await store.attachSubscription(claim.claimId, id))) {
          return json(409, { error: "Checkout could not be started. Try again" });
        }
        return json(200, { planId, mock: true });
      }
    }
  } catch {
    return failed();
  }
}

/**
 * Mock checkout, step 2: stands in for the verified webhook. It applies `subscription.activated`
 * and `subscription.charged` through `store.applyEvent`, the same single-transaction path the
 * webhook uses (idempotent by event id, credits reset by the store, C4). It acts only on this
 * learner's own pending MOCK checkout for the named plan.
 */
export async function handleMockConfirm(
  request: Request,
  deps: MockPaymentsDeps,
): Promise<Response> {
  if (paymentsMode(deps.env) !== "mock" || !deps.store) return unavailable();
  const auth = await requireUser(request, deps.authenticate);
  if (!auth.ok) return auth.response;
  const body = await readBody(request, mockBody);
  if (!body.ok) return body.response;
  const { planId } = body.data;
  const userId = auth.user.id;
  const store = deps.store;

  try {
    const live = await store.liveSubscription(userId);
    const subId = live?.razorpaySubscriptionId ?? null;
    if (!live || !isMock(subId) || live.planId !== planId) {
      return json(409, { error: "No test checkout to confirm. Start again from Plans" });
    }
    if (live.status === "active") {
      return json(200, { applied: true, alreadyActive: true, planId });
    }
    if (live.status !== "pending") {
      return json(409, { error: "No test checkout to confirm. Start again from Plans" });
    }
    const at = (deps.now ?? (() => new Date()))();
    const common = {
      kind: "subscription" as const,
      userId,
      planId,
      razorpaySubscriptionId: subId,
      status: "active" as const,
    };
    // Deterministic event ids: a double click or a retry replays as "duplicate", never twice.
    await store.applyEvent({ ...common, eventId: `${subId}:activated`, eventAt: at });
    await store.applyEvent({
      ...common,
      eventId: `${subId}:charged`,
      grantCredits: PAYMENT_PLANS[planId].monthlyCredits,
      eventAt: at,
    });
    return json(200, { applied: true, planId });
  } catch {
    return failed();
  }
}

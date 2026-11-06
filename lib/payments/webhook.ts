import { z } from "zod";
import { isPlanId, PAYMENT_PLANS, planIdFromRazorpayPlan, type PlanId } from "./plans";
import { verifyWebhookSignature } from "./signature";
import type { ApplyEventInput, PaymentStore } from "./store";

const subscriptionEvent = z.object({
  event: z.enum([
    "subscription.activated",
    "subscription.charged",
    "subscription.cancelled",
    "subscription.halted",
  ]),
  // Unix seconds when Razorpay created the event; used to ignore out-of-order deliveries.
  created_at: z.number().int().positive().optional(),
  payload: z.object({
    subscription: z.object({
      entity: z.object({
        id: z.string().min(1),
        plan_id: z.string().min(1),
        // Written by /api/razorpay/subscribe when the subscription is created.
        notes: z.looseObject({ user_id: z.string().min(1), plan: z.string().optional() }),
      }),
    }),
  }),
});

export interface WebhookDeps {
  store: PaymentStore;
  webhookSecret: string | undefined;
  env?: Record<string, string | undefined>;
}

const ok = () => new Response(null, { status: 200 });
const bad = () => new Response(null, { status: 400 });
const retry = () => new Response(null, { status: 500 });

/**
 * Verifies the signature on the RAW body before anything is parsed (POLICY 3.3, P2). All state
 * changes happen in one `store.applyEvent` transaction that also claims the event id, so a replay
 * is a no-op and a failure leaves nothing half-applied (Razorpay retries on 500).
 */
export async function handleRazorpayWebhook(
  request: Request,
  deps: WebhookDeps,
): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature");
  if (!verifyWebhookSignature(rawBody, signature, deps.webhookSecret)) return bad();

  const eventId = request.headers.get("x-razorpay-event-id");
  if (!eventId) return bad();

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return bad();
  }

  const input = toApplyInput(eventId, json, deps.env);
  if (input === "invalid") return bad();

  try {
    const outcome = await deps.store.applyEvent(input);
    if (outcome === "unknown_subscription") {
      // The event can beat our DB row: Razorpay created the subscription but we have not stored its
      // id yet. The event id was NOT claimed, so answer a retryable 503 (generic body) and let
      // Razorpay redeliver. A truly unknown subscription keeps retrying and stays in the logs.
      // Ids only: no emails, no code.
      console.warn(
        JSON.stringify({ event: "webhook_unknown_subscription", eventId, userId: input.userId }),
      );
      return new Response(null, { status: 503 });
    }
    if (outcome === "mismatch") {
      console.warn(JSON.stringify({ event: "webhook_subscription_mismatch", eventId }));
    }
    return ok();
  } catch {
    return retry();
  }
}

function toApplyInput(
  eventId: string,
  json: unknown,
  env: Record<string, string | undefined> | undefined,
): ApplyEventInput | "invalid" {
  const parsed = subscriptionEvent.safeParse(json);
  if (!parsed.success) {
    // payment.failed (P3: never changes plan or credits) and any other event we do not act on:
    // claim the id and acknowledge so Razorpay stops retrying.
    return { eventId, kind: "ignore" };
  }

  const { event, payload, created_at } = parsed.data;
  const sub = payload.subscription.entity;
  const planId: PlanId | null =
    planIdFromRazorpayPlan(sub.plan_id, env) ??
    (sub.notes.plan && isPlanId(sub.notes.plan) ? sub.notes.plan : null);
  if (!planId) return "invalid";

  const status =
    event === "subscription.cancelled"
      ? "cancelled"
      : event === "subscription.halted"
        ? "halted"
        : "active";
  return {
    eventId,
    kind: "subscription",
    userId: sub.notes.user_id,
    planId,
    razorpaySubscriptionId: sub.id,
    status,
    // Status only on activated; credits come from each charged event (C4: reset, no rollover).
    grantCredits:
      event === "subscription.charged" ? PAYMENT_PLANS[planId].monthlyCredits : undefined,
    eventAt: created_at ? new Date(created_at * 1000) : undefined,
  };
}

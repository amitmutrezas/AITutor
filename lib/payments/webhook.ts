import { z } from "zod";
import { isPlanId, planIdFromRazorpayPlan, type PlanId } from "./plans";
import { verifyWebhookSignature } from "./signature";
import type { PaymentStore } from "./store";

const subscriptionEvent = z.object({
  event: z.enum([
    "subscription.activated",
    "subscription.charged",
    "subscription.cancelled",
    "subscription.halted",
  ]),
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

const paymentFailedEvent = z.object({ event: z.literal("payment.failed") });

export interface WebhookDeps {
  store: PaymentStore;
  webhookSecret: string | undefined;
  env?: Record<string, string | undefined>;
}

const ok = () => new Response(null, { status: 200 });
const bad = () => new Response(null, { status: 400 });

/** Verifies the signature on the RAW body before anything is parsed (POLICY 3.3, P2). */
export async function handleRazorpayWebhook(
  request: Request,
  deps: WebhookDeps,
): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature");
  if (!verifyWebhookSignature(rawBody, signature, deps.webhookSecret)) return bad();

  const eventId = request.headers.get("x-razorpay-event-id");
  if (!eventId) return bad();

  if (await deps.store.hasProcessedEvent(eventId)) return ok();

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return bad();
  }

  if (paymentFailedEvent.safeParse(json).success) {
    // P3: a failed payment never changes the plan or credits.
    await deps.store.markProcessed(eventId);
    return ok();
  }

  const parsed = subscriptionEvent.safeParse(json);
  if (!parsed.success) {
    // Valid signature but an event we do not act on: acknowledge so Razorpay stops retrying.
    await deps.store.markProcessed(eventId);
    return ok();
  }

  const { event, payload } = parsed.data;
  const sub = payload.subscription.entity;
  const userId = sub.notes.user_id;
  const planId: PlanId | null =
    planIdFromRazorpayPlan(sub.plan_id, deps.env) ??
    (sub.notes.plan && isPlanId(sub.notes.plan) ? sub.notes.plan : null);
  if (!planId) return bad();

  switch (event) {
    case "subscription.activated":
      // Status only: credits come from the first subscription.charged, one per charge.
      await deps.store.setSubscription(userId, planId, "active", sub.id);
      break;
    case "subscription.charged":
      await deps.store.setSubscription(userId, planId, "active", sub.id);
      await deps.store.grantMonthlyCredits(userId, planId);
      break;
    case "subscription.cancelled":
      await deps.store.setSubscription(userId, planId, "cancelled", sub.id);
      break;
    case "subscription.halted":
      await deps.store.setSubscription(userId, planId, "halted", sub.id);
      break;
  }
  await deps.store.markProcessed(eventId);
  return ok();
}

import { z } from "zod";
import { PAYMENT_PLANS, PLAN_IDS, razorpayPlanId } from "./plans";

export const subscribeBody = z.strictObject({ planId: z.enum(PLAN_IDS) });

export interface SubscribeDeps {
  keyId: string | undefined;
  keySecret: string | undefined;
  env?: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
}

const json = (body: unknown, status: number) => Response.json(body, { status });

/** Creates a Razorpay subscription. The client never decides a plan change: only the webhook does (P1). */
export async function handleSubscribe(request: Request, deps: SubscribeDeps): Promise<Response> {
  // TODO(M5): replace the x-user-id header with the real signed-in session user.
  const userId = request.headers.get("x-user-id");
  if (!userId) return json({ error: "Sign in required" }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const parsed = subscribeBody.safeParse(raw);
  if (!parsed.success) return json({ error: "Invalid request" }, 400);

  const planId = parsed.data.planId;
  const rzpPlan = razorpayPlanId(planId, deps.env);
  if (!deps.keyId || !deps.keySecret || !rzpPlan) {
    return json({ error: "Payments unavailable" }, 503);
  }

  try {
    const res = await (deps.fetchFn ?? fetch)("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(`${deps.keyId}:${deps.keySecret}`).toString("base64")}`,
      },
      body: JSON.stringify({
        plan_id: rzpPlan,
        total_count: PAYMENT_PLANS[planId].totalCount,
        customer_notify: 1,
        notes: { user_id: userId, plan: planId },
      }),
    });
    if (!res.ok) return json({ error: "Could not start checkout" }, 502);
    const data = z.object({ id: z.string().min(1) }).safeParse(await res.json());
    if (!data.success) return json({ error: "Could not start checkout" }, 502);
    return json({ subscriptionId: data.data.id, keyId: deps.keyId, planId }, 200);
  } catch {
    return json({ error: "Could not start checkout" }, 502);
  }
}

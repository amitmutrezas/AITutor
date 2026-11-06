export interface RazorpayApiDeps {
  keyId: string | undefined;
  keySecret: string | undefined;
  fetchFn?: typeof fetch;
}

const BASE = "https://api.razorpay.com/v1";

export function razorpayAuthHeader(keyId: string, keySecret: string): string {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

/**
 * Cancels a subscription immediately at Razorpay. Used when a learner deletes their account or an
 * unpaid checkout for another plan is replaced. Returns false on any failure; callers decide
 * whether that blocks them. Never throws and never exposes the response body.
 */
export async function cancelRazorpaySubscription(
  deps: RazorpayApiDeps,
  subscriptionId: string,
): Promise<boolean> {
  if (!deps.keyId || !deps.keySecret) return false;
  try {
    const res = await (deps.fetchFn ?? fetch)(
      `${BASE}/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: razorpayAuthHeader(deps.keyId, deps.keySecret),
        },
        body: JSON.stringify({ cancel_at_cycle_end: 0 }),
      },
    );
    if (res.ok) return true;
    // Idempotent for retries (for example after a failed account delete): already cancelled is success.
    return await isCancelledAtRazorpay(deps, subscriptionId);
  } catch {
    return false;
  }
}

async function isCancelledAtRazorpay(
  deps: RazorpayApiDeps,
  subscriptionId: string,
): Promise<boolean> {
  try {
    const res = await (deps.fetchFn ?? fetch)(
      `${BASE}/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { headers: { authorization: razorpayAuthHeader(deps.keyId!, deps.keySecret!) } },
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { status?: unknown };
    return body.status === "cancelled";
  } catch {
    return false;
  }
}

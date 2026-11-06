// Payments mode switch (M7). Unset means the real Razorpay path, exactly as before.
// "mock" is an explicit opt-in that never touches Razorpay: the confirm step stands in for the
// verified webhook and applies the plan through the same PaymentStore transaction.
export type PaymentsMode = "razorpay" | "mock" | "off";

type Env = Record<string, string | undefined>;

/**
 * Fail closed: only the exact value "mock" turns mock mode on, and only when no live Razorpay key
 * is configured (a deploy that holds live keys must never offer free plans). Any other non-empty
 * value is a typo and turns checkout off instead of silently picking a path.
 */
export function paymentsMode(env: Env = process.env): PaymentsMode {
  const raw = env.PAYMENTS_MODE;
  if (raw === undefined || raw === "" || raw === "razorpay") return "razorpay";
  if (raw === "mock") return env.RAZORPAY_KEY_ID?.startsWith("rzp_live_") ? "off" : "mock";
  return "off";
}

/** Id prefix of subscriptions created in mock mode. The confirm step only acts on these. */
export const MOCK_SUBSCRIPTION_PREFIX = "mock_sub_";

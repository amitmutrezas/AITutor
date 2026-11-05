// Plan catalogue for payments. All values are PLACEHOLDER until Amit decides
// prices and credits (PLAN.md decision 1). UI must read from here (POLICY 3.5, P4).

export const PLAN_IDS = ["basic", "advanced"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PaymentPlan {
  id: PlanId;
  name: string;
  /** PLACEHOLDER: integer credits granted per billing cycle. */
  monthlyCredits: number;
  /** PLACEHOLDER: price in paise (INR minor unit); null = not decided yet. */
  pricePaise: number | null;
  /** Name of the server env var holding the Razorpay plan id created in the dashboard. */
  razorpayPlanEnv: string;
  /** PLACEHOLDER: number of billing cycles for a new subscription. */
  totalCount: number;
}

export const PAYMENT_PLANS: Record<PlanId, PaymentPlan> = {
  basic: {
    id: "basic",
    name: "Basic",
    monthlyCredits: 30, // PLACEHOLDER
    pricePaise: null, // PLACEHOLDER
    razorpayPlanEnv: "RAZORPAY_PLAN_ID_BASIC",
    totalCount: 120, // PLACEHOLDER
  },
  advanced: {
    id: "advanced",
    name: "Advanced",
    monthlyCredits: 100, // PLACEHOLDER
    pricePaise: null, // PLACEHOLDER
    razorpayPlanEnv: "RAZORPAY_PLAN_ID_ADVANCED",
    totalCount: 120, // PLACEHOLDER
  },
};

export function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value);
}

/** Razorpay plan id for one of our plans, read from server env. */
export function razorpayPlanId(
  planId: PlanId,
  env: Record<string, string | undefined> = process.env,
): string | null {
  return env[PAYMENT_PLANS[planId].razorpayPlanEnv] || null;
}

/** Reverse lookup: which of our plans does a Razorpay plan id belong to. */
export function planIdFromRazorpayPlan(
  razorpayId: string,
  env: Record<string, string | undefined> = process.env,
): PlanId | null {
  return PLAN_IDS.find((id) => razorpayPlanId(id, env) === razorpayId) ?? null;
}

/** Human price text. Never a hard-coded number in UI strings. */
export function formatPrice(plan: PaymentPlan): string {
  if (plan.pricePaise === null) return "Price to be announced";
  return `Rs ${(plan.pricePaise / 100).toFixed(2)} / month`;
}

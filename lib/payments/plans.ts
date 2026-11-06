// Plan catalogue for payments, derived from lib/config (single source of truth). Values are
// PLACEHOLDER until Amit decides prices and credits (PLAN.md decision 1). UI reads from here (POLICY 3.5, P4).
import { PLANS } from "../config";

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

function fromConfig(id: PlanId): PaymentPlan {
  const p = PLANS[id];
  return {
    id,
    name: p.name,
    monthlyCredits: p.monthlyCredits,
    pricePaise: p.pricePaise,
    razorpayPlanEnv: p.razorpayPlanEnv,
    totalCount: p.totalCount,
  };
}

/** Derived from lib/config, the single source of truth for plans. */
export const PAYMENT_PLANS: Record<PlanId, PaymentPlan> = {
  basic: fromConfig("basic"),
  advanced: fromConfig("advanced"),
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

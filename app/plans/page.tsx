import { PlanCard } from "../../components/plans/PlanCard";
import { PolicyFooter } from "../../components/plans/PolicyFooter";
import { PAYMENT_PLANS, PLAN_IDS } from "../../lib/payments/plans";

export const metadata = { title: "Plans - Unstuck" };

const MESSAGES: Record<string, string> = {
  payment_failed:
    "Your payment did not go through. Nothing was charged and your plan has not changed.",
  cancelled: "You closed checkout before paying. Your plan has not changed.",
  signin: "Please sign in to choose a plan. Your plan has not changed.",
  unavailable: "Checkout is not available right now. Your plan has not changed.",
};

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  const key = Array.isArray(error) ? error[0] : error;
  const message = key ? MESSAGES[key] : undefined;

  return (
    <main>
      <h1>Pick a plan</h1>
      <p>
        Both plans give you the same five hint levels. The difference is how many credits you get
        each month.
      </p>
      {message ? (
        <p
          role="alert"
          style={{ border: "1px solid #b3261e", padding: "0.75rem", borderRadius: 8 }}
        >
          {message}
        </p>
      ) : null}
      <div style={{ display: "grid", gap: "1rem" }}>
        {PLAN_IDS.map((id) => (
          <PlanCard key={id} plan={PAYMENT_PLANS[id]} />
        ))}
      </div>
      <p>
        <small>
          Prices and credit amounts shown here are placeholders until they are decided. Credits
          refill monthly; see the refund policy for cancellation terms.
        </small>
      </p>
      <PolicyFooter />
    </main>
  );
}

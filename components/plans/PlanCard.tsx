import { formatPrice, type PaymentPlan } from "../../lib/payments/plans";

const box = {
  border: "1px solid #b9d3c2",
  borderRadius: 8,
  padding: "1rem",
  background: "#fff",
} as const;

export function PlanCard({ plan }: { plan: PaymentPlan }) {
  return (
    <section style={box} aria-labelledby={`plan-${plan.id}`}>
      <h2 id={`plan-${plan.id}`} style={{ margin: 0 }}>
        {plan.name}
      </h2>
      <p style={{ fontSize: "1.3rem", margin: "0.25rem 0" }}>{formatPrice(plan)}</p>
      <p>{plan.monthlyCredits} credits each month for Locate, Scaffold and Reveal hints.</p>
      <a href={`/checkout?plan=${plan.id}`}>Choose {plan.name}</a>
    </section>
  );
}

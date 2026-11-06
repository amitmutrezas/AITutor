import { redirect } from "next/navigation";
import { CheckoutClient } from "../../components/plans/CheckoutClient";
import { PolicyFooter } from "../../components/plans/PolicyFooter";
import { paymentsMode } from "../../lib/payments/mode";
import { PAYMENT_PLANS, formatPrice, isPlanId } from "../../lib/payments/plans";

export const metadata = { title: "Checkout - Unstuck" };

export const dynamic = "force-dynamic";

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string | string[] }>;
}) {
  const { plan } = await searchParams;
  const id = Array.isArray(plan) ? plan[0] : plan;
  if (!id || !isPlanId(id)) redirect("/plans");
  const p = PAYMENT_PLANS[id];
  const mode = paymentsMode();
  if (mode === "off") redirect("/plans?error=unavailable");

  return (
    <main>
      <CheckoutClient
        planId={p.id}
        planName={p.name}
        priceText={formatPrice(p)}
        mode={mode}
        monthlyCredits={p.monthlyCredits}
      />
      <PolicyFooter />
    </main>
  );
}

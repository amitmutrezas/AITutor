import { connection } from "next/server";
import { paymentsMode } from "../../lib/payments/mode";

/**
 * Visible on every page while PAYMENTS_MODE=mock. `connection()` makes the layout read the
 * environment per request, so a build made without the variable cannot hide (or fake) the banner.
 */
export async function TestModeBanner() {
  await connection();
  if (paymentsMode() !== "mock") return null;
  return (
    <div role="status" className="test-banner" data-testid="test-mode-banner">
      Test mode: payments are simulated and no real payment is taken.
    </div>
  );
}

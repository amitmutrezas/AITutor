import { unavailable } from "../../../../lib/api/http";
import { paymentsMode } from "../../../../lib/payments/mode";
import { handleSubscribe } from "../../../../lib/payments/subscribe";
import { getServices } from "../../../../lib/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Real checkout only in the default mode; mock mode has its own routes and "off" fails closed.
  if (paymentsMode() !== "razorpay") return unavailable();
  const s = getServices();
  if (!s) return unavailable();
  return handleSubscribe(request, {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    authenticate: s.authenticate,
    store: s.payments,
  });
}

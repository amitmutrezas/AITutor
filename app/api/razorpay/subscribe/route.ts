import { unavailable } from "../../../../lib/api/http";
import { handleSubscribe } from "../../../../lib/payments/subscribe";
import { getServices } from "../../../../lib/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const s = getServices();
  if (!s) return unavailable();
  return handleSubscribe(request, {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    authenticate: s.authenticate,
    store: s.payments,
  });
}

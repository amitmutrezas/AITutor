import { handleRazorpayWebhook } from "../../../../lib/payments/webhook";
import { getServices } from "../../../../lib/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Unauthenticated by design: the signature is the authentication (secure-endpoint rule 1).
export async function POST(request: Request) {
  const store = getServices()?.payments;
  // Fail closed: without the durable transactional store, money events must not be acknowledged.
  if (!store) return new Response(null, { status: 503 });
  return handleRazorpayWebhook(request, {
    store,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  });
}

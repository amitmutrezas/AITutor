import { handleRazorpayWebhook } from "../../../../lib/payments/webhook";
import { getPaymentStore } from "../../../../lib/payments/store";

export const runtime = "nodejs";

// Unauthenticated by design: the signature is the authentication (secure-endpoint rule 1).
export async function POST(request: Request) {
  const store = getPaymentStore();
  // Fail closed in production until M5 supplies the durable transactional store (lib/credits).
  if (!store) return new Response(null, { status: 503 });
  return handleRazorpayWebhook(request, {
    store,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  });
}

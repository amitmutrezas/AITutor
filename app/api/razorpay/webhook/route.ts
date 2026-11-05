import { handleRazorpayWebhook } from "../../../../lib/payments/webhook";
import { getPaymentStore } from "../../../../lib/payments/store";

export const runtime = "nodejs";

// Unauthenticated by design: the signature is the authentication (secure-endpoint rule 1).
export async function POST(request: Request) {
  return handleRazorpayWebhook(request, {
    store: getPaymentStore(),
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  });
}

import { handleSubscribe } from "../../../../lib/payments/subscribe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleSubscribe(request, {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
  });
}

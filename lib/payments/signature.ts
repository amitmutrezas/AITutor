import { createHmac, timingSafeEqual } from "node:crypto";

function hmacHex(message: string, secret: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

function safeEqualHex(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Webhook: HMAC SHA256 of the RAW body with the webhook secret, compared to X-Razorpay-Signature. */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  webhookSecret: string | undefined,
): boolean {
  if (!signature || !webhookSecret) return false;
  return safeEqualHex(hmacHex(rawBody, webhookSecret), signature);
}

/**
 * Checkout (subscription) signature returned to the client handler:
 * HMAC SHA256 of `razorpay_payment_id|subscription_id` with the API key secret.
 * Note the order: payment id first, then subscription id.
 */
export function verifySubscriptionCheckoutSignature(
  params: { paymentId: string; subscriptionId: string; signature: string | null | undefined },
  keySecret: string | undefined,
): boolean {
  if (!params.signature || !keySecret) return false;
  return safeEqualHex(
    hmacHex(`${params.paymentId}|${params.subscriptionId}`, keySecret),
    params.signature,
  );
}

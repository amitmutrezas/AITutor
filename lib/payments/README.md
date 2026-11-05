# Payments (Razorpay, test mode)

Covers SPEC P1-P4 and N1 (POLICY 3 and 4). The app trusts only the signature-verified webhook for
plan and credit changes, never the checkout redirect or client callback.

## What Amit must provide

All are server-only environment variables (set in Vercel and local `.env.local`; never committed):

- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`: Razorpay **test mode** API keys.
- `RAZORPAY_WEBHOOK_SECRET`: the secret you type when creating the webhook in the dashboard.
- `RAZORPAY_PLAN_ID_BASIC` and `RAZORPAY_PLAN_ID_ADVANCED`: ids of the two subscription plans
  created in the Razorpay dashboard (Subscriptions > Plans), monthly period.
  Their prices must match the decided prices.

Dashboard webhook setup:

- URL: `https://<your-domain>/api/razorpay/webhook`
- Events: `subscription.activated`, `subscription.charged`, `subscription.cancelled`,
  `subscription.halted`, `payment.failed`.

Decisions still needed in `lib/payments/plans.ts` (all marked PLACEHOLDER): prices (`pricePaise`),
`monthlyCredits`, `totalCount`. `RAZORPAY_*` names should be added to `.env.example` by someone
allowed to edit it (the secret-guard hook blocks `.env*` edits for agents).

## Status

- Persistence is behind `PaymentStore` (`store.ts`). Only the in-memory implementation exists.
  `TODO(M5)`: Supabase implementation, with plan change, credit grant and `markProcessed` in one
  transaction via `lib/credits`.
- `/api/razorpay/subscribe` reads the user from the `x-user-id` header as a placeholder.
  `TODO(M5)`: use the real session. Until then the checkout page cannot complete a real purchase.
- Signature formats follow Razorpay docs (checked via Context7): webhook = HMAC SHA256 of the raw
  body with the webhook secret, header `X-Razorpay-Signature`, event id in `X-Razorpay-Event-Id`;
  subscription checkout = HMAC SHA256 of `razorpay_payment_id|razorpay_subscription_id` with the
  key secret.

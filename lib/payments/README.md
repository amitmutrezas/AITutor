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

Decisions still needed in `lib/config/index.ts` (all marked PLACEHOLDER): prices (`pricePaise`),
`monthlyCredits`, `totalCount`. These now live in `lib/config` (`PLANS`, keys `free`, `basic`, `advanced`),
the single source of truth; `plans.ts` derives from it. The `RAZORPAY_*` names are in `.env.example`.

## Status (M5)

- Persistence is behind `PaymentStore` (`store.ts`). `supabase-store.ts` is the durable implementation:
  every method is one Postgres function (`supabase/migrations/0002`), so each is one transaction.
  `InMemoryPaymentStore` is a test fake only; the running app has no in-memory fallback and the
  webhook and subscribe routes answer a generic 503 when the Supabase env vars are missing.
- `applyEvent` claims the event id (primary key on `payment_events`), checks the event belongs to the
  learner's current subscription (the row with that Razorpay subscription id and user), applies lifecycle
  ordering (cancelled is terminal; events older than the last applied one are ignored), then changes plan
  and status and resets credits, all in one transaction.
- A webhook for a subscription id no row has yet (it can beat `attachSubscription`) does not claim the event id and
  answers a retryable 503, so Razorpay's retry is applied once the id is attached.
- Ordering rule: Razorpay calls and DB writes are never assumed to succeed together. Switching plans cancels the
  old subscription at Razorpay first and only then closes the old row (`payments_close_checkout`); a failed cancel
  stops the request with nothing changed. If Razorpay created a subscription but its id cannot be stored, the new
  subscription is cancelled; if that fails too the claim row is kept and `razorpay_subscription_unattached` is
  logged with the id. Account deletion is blocked if any row with a Razorpay subscription id (even pending) cannot
  be cancelled there. A renewal reset (`credits_reset`) expires open credit reservations with no refund (C4).
- `/api/cron/reconcile-credits` (vercel.json, every 5 minutes, `Authorization: Bearer $CRON_SECRET`) releases stale
  credit reservations. Vercel Cron needs a plan that allows sub-daily schedules.
- `/api/razorpay/subscribe` uses the real session (`lib/auth`). The checkout attempt is claimed in the
  database before Razorpay is called: a pending checkout for the same plan is reused, an active
  subscription is refused (409), and a pending checkout for another plan is closed at Razorpay.
- Known limit: a learner who pays a checkout that was closed by a plan switch is not matched by the
  webhook (logged as `webhook_unknown_subscription`) and needs a manual refund.
- Signature formats follow Razorpay docs (checked via Context7): webhook = HMAC SHA256 of the raw
  body with the webhook secret, header `X-Razorpay-Signature`, event id in `X-Razorpay-Event-Id`;
  subscription checkout = HMAC SHA256 of `razorpay_payment_id|razorpay_subscription_id` with the
  key secret.

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

## Lock order (single, global) and who takes what

Every SQL function below runs in one transaction and takes locks only in this order, possibly skipping levels.
Two transactions therefore never wait on each other in a cycle. This is also asserted statically in
`supabase/migrations.test.ts` and exercised (sequentially) with a throwaway Postgres; concurrent interleavings
cannot be run in unit tests, so the order itself is the safety argument. When adding a function, take its locks in
this order or do not add it.

| Level | Lock                                            | Taken by                                                                                                                                                       |
| ----- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `profiles` row (`FOR UPDATE`)                   | `account_begin_delete`, `account_cancel_delete`, `account_delete`, `payments_claim_checkout`, `payments_attach_subscription`                                   |
| 2     | `subscriptions` row(s)                          | `payments_claim_checkout`, `payments_apply_event`, `account_delete` (`payments_close_checkout` and `payments_abandon_checkout` touch one row by id)            |
| 3     | `credit_balances` row (`_credits_lock_balance`) | `credits_reserve`, `credits_release`, `credits_settle_hint`, `credits_reconcile`, `credits_reset` (also reached from `payments_apply_event`), `account_delete` |
| 4     | `credit_reservations` rows                      | `_credits_release_locked` (via release and reconcile), `credits_settle_hint`, `credits_reset` (expires them), `account_delete`                                 |
| 5     | `payment_events` insert (unique event id)       | `payments_apply_event`, always last                                                                                                                            |

Rules that follow from it:

- A function that only knows a reservation id reads its `user_id` without a lock, takes the balance lock (3), and only then
  locks the reservation (4). `credits_reconcile` visits candidates ordered by user, so two reconciles cannot cross.
- `credits_reset` takes the balance lock first. A concurrent `credits_reserve` either committed before (its reservation is
  expired by the reset, no refund, C4) or waits and then reserves from the new allowance.
- Checkout vs deletion: `payments_claim_checkout` and `payments_attach_subscription` lock the profile row and refuse while
  `profiles.deleting_at` is under 10 minutes old. Deletion is three steps: `account_begin_delete` (locks the profile, sets the
  marker, returns the live subscription), then the Razorpay cancel, then `account_delete` (requires the marker, locks 1-4,
  cascades). If the cancel fails the marker is cleared (`account_cancel_delete`) and the account is unchanged. If the process
  dies mid-way the marker expires on its own.
- Handlers that mix Razorpay with the DB (`lib/payments/subscribe.ts`, `lib/account/handler.ts`) call the Razorpay side only
  between two of these single-transaction steps and define what is true if the next step fails.

Inventory of SQL functions that touch balance, reservations, subscriptions or the profile row: `credits_get_balance`
(no lock, read), `credits_reserve`, `credits_release`, `credits_settle_hint`, `credits_reconcile`, `credits_reset`,
`payments_claim_checkout`, `payments_attach_subscription`, `payments_close_checkout`, `payments_abandon_checkout`,
`payments_apply_event`, `payments_live_subscription` (read), `account_get` (read), `account_begin_delete`,
`account_cancel_delete`, `account_delete`. Handlers: `/api/hint` (reserve, settle or release), `/api/razorpay/webhook`
(`applyEvent`), `/api/razorpay/subscribe`, `/api/account` DELETE, `/api/cron/reconcile-credits`.

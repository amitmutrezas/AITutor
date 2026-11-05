---
name: secure-endpoint
description: Security checklist for API routes and webhooks. Use whenever creating or modifying anything under app/api or handling auth, credits or payments.
---
# Secure endpoint

1. Authentication: every route requires a signed-in user except the Razorpay webhook (which requires a valid signature) and `/api/health`.
2. Validate the body and query with Zod and reject unknown fields.
3. Rate limit the hint route per user.
4. Webhooks: verify the signature on the raw body, dedupe by event id, return 200 for already-processed events.
5. Credits and plan changes only through `lib/credits` in a transaction.
6. Errors return generic messages. Never include stack traces, keys, learner code or SQL.
7. Logs carry user id, exercise id, level, code hash, token counts. Never code.
8. Add or update tests that cover the unauthenticated, invalid-input and happy paths.

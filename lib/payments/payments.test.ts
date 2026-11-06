import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Authenticate } from "../auth/types";
import { PLANS } from "../config";
import { PAYMENT_PLANS, planIdFromRazorpayPlan } from "./plans";
import { verifySubscriptionCheckoutSignature, verifyWebhookSignature } from "./signature";
import { subscribeBody, handleSubscribe } from "./subscribe";
import { InMemoryPaymentStore } from "./store";
import { POST as webhookRoute } from "../../app/api/razorpay/webhook/route";
import { handleRazorpayWebhook } from "./webhook";

const SECRET = "test_webhook_secret_not_real";
const env = { RAZORPAY_PLAN_ID_BASIC: "plan_basic_x", RAZORPAY_PLAN_ID_ADVANCED: "plan_adv_x" };
const sign = (body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(body).digest("hex");

function event(
  name: string,
  opts: { planId?: string; sub?: string; user?: string; at?: number } = {},
) {
  return JSON.stringify({
    event: name,
    ...(opts.at ? { created_at: opts.at } : {}),
    payload: {
      subscription: {
        entity: {
          id: opts.sub ?? "sub_1",
          plan_id: opts.planId ?? "plan_basic_x",
          notes: { user_id: opts.user ?? "u1", plan: "basic" },
        },
      },
    },
  });
}

function hook(body: string, opts: { sig?: string; id?: string | null } = {}) {
  const headers: Record<string, string> = { "x-razorpay-signature": opts.sig ?? sign(body) };
  if (opts.id !== null) headers["x-razorpay-event-id"] = opts.id ?? "evt_1";
  return new Request("http://x/api/razorpay/webhook", { method: "POST", body, headers });
}

const deps = (store: InMemoryPaymentStore) => ({ store, webhookSecret: SECRET, env });

/** A learner who started checkout: a pending row with a Razorpay subscription id attached. */
async function checkedOut(userId = "u1", sub = "sub_1", plan: "basic" | "advanced" = "basic") {
  const store = new InMemoryPaymentStore();
  await attach(store, userId, sub, plan);
  return store;
}
async function attach(
  store: InMemoryPaymentStore,
  userId: string,
  sub: string,
  plan: "basic" | "advanced" = "basic",
) {
  const claim = await store.claimCheckout(userId, plan);
  if (claim.kind !== "claimed") throw new Error("expected a claim");
  await store.attachSubscription(claim.claimId, sub);
}

describe("P2: signature", () => {
  it("P2: webhook signature matches an independently computed HMAC SHA256 vector", () => {
    const body = '{"a":1,"b":2,"c":{"d":3}}';
    const expected = createHmac("sha256", "123456").update(body).digest("hex");
    expect(verifyWebhookSignature(body, expected, "123456")).toBe(true);
    expect(verifyWebhookSignature(body + " ", expected, "123456")).toBe(false);
    expect(verifyWebhookSignature(body, expected, "other")).toBe(false);
    expect(verifyWebhookSignature(body, "short", "123456")).toBe(false);
    expect(verifyWebhookSignature(body, undefined, "123456")).toBe(false);
    expect(verifyWebhookSignature(body, expected, undefined)).toBe(false);
  });

  it("P1: checkout signature is HMAC of payment_id|subscription_id with the key secret", () => {
    const sig = createHmac("sha256", "key_secret").update("pay_1|sub_1").digest("hex");
    const ok = { paymentId: "pay_1", subscriptionId: "sub_1", signature: sig };
    expect(verifySubscriptionCheckoutSignature(ok, "key_secret")).toBe(true);
    expect(verifySubscriptionCheckoutSignature({ ...ok, paymentId: "pay_2" }, "key_secret")).toBe(
      false,
    );
    // wrong order (subscription|payment) must not verify
    const swapped = createHmac("sha256", "key_secret").update("sub_1|pay_1").digest("hex");
    expect(verifySubscriptionCheckoutSignature({ ...ok, signature: swapped }, "key_secret")).toBe(
      false,
    );
  });
});

describe("P2: webhook handler", () => {
  it("P2: bad signature is rejected with 400 and changes nothing", async () => {
    const store = await checkedOut();
    const body = event("subscription.charged");
    const res = await handleRazorpayWebhook(hook(body, { sig: "deadbeef" }), deps(store));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("");
    expect(store.subscriptions.get("u1")?.status).toBe("pending");
    expect(store.credits.size).toBe(0);
    expect(store.processed.size).toBe(0);
  });

  it("P2: missing webhook secret rejects everything", async () => {
    const store = await checkedOut();
    const body = event("subscription.activated");
    const res = await handleRazorpayWebhook(hook(body), { store, webhookSecret: undefined, env });
    expect(res.status).toBe(400);
  });

  it("P2: activated updates status only and grants no credits", async () => {
    const store = await checkedOut();
    const res = await handleRazorpayWebhook(hook(event("subscription.activated")), deps(store));
    expect(res.status).toBe(200);
    expect(store.subscriptions.get("u1")?.status).toBe("active");
    expect(store.credits.size).toBe(0);
  });

  it("C4: renewal resets credits to the allowance, no rollover", async () => {
    const store = await checkedOut();
    store.credits.set("u1", 20);
    await handleRazorpayWebhook(hook(event("subscription.charged"), { id: "e1" }), deps(store));
    expect(store.credits.get("u1")).toBe(PAYMENT_PLANS.basic.monthlyCredits);
  });

  it("P2: charged updates plan and grants credits once; replayed event is ignored", async () => {
    const store = await checkedOut();
    const body = event("subscription.charged");
    expect((await handleRazorpayWebhook(hook(body), deps(store))).status).toBe(200);
    expect(store.subscriptions.get("u1")).toMatchObject({
      planId: "basic",
      status: "active",
      razorpaySubscriptionId: "sub_1",
    });
    expect(store.credits.get("u1")).toBe(PAYMENT_PLANS.basic.monthlyCredits);

    // A replay must not reset credits that were spent in between.
    store.credits.set("u1", 5);
    expect((await handleRazorpayWebhook(hook(body), deps(store))).status).toBe(200);
    expect(store.credits.get("u1")).toBe(5);
  });

  it("C4: a second charge with a new event id resets, not accumulates", async () => {
    const store = await checkedOut();
    await handleRazorpayWebhook(hook(event("subscription.charged"), { id: "e1" }), deps(store));
    await handleRazorpayWebhook(hook(event("subscription.charged"), { id: "e2" }), deps(store));
    expect(store.credits.get("u1")).toBe(PAYMENT_PLANS.basic.monthlyCredits);
  });

  it("P2: cancelled and halted update status without granting credits", async () => {
    const store = await checkedOut();
    await handleRazorpayWebhook(hook(event("subscription.halted"), { id: "e2" }), deps(store));
    expect(store.subscriptions.get("u1")?.status).toBe("halted");
    await handleRazorpayWebhook(hook(event("subscription.cancelled"), { id: "e1" }), deps(store));
    expect(store.subscriptions.get("u1")?.status).toBe("cancelled");
    expect(store.credits.size).toBe(0);
  });

  it("P2: missing event id is rejected", async () => {
    const store = await checkedOut();
    const res = await handleRazorpayWebhook(
      hook(event("subscription.activated"), { id: null }),
      deps(store),
    );
    expect(res.status).toBe(400);
  });

  it("P3: payment.failed leaves plan and credits unchanged", async () => {
    const store = await checkedOut();
    await handleRazorpayWebhook(hook(event("subscription.activated"), { id: "e0" }), deps(store));
    const body = JSON.stringify({ event: "payment.failed", payload: { payment: { entity: {} } } });
    const res = await handleRazorpayWebhook(hook(body, { id: "e9" }), deps(store));
    expect(res.status).toBe(200);
    expect(store.subscriptions.get("u1")?.status).toBe("active");
    expect(store.credits.size).toBe(0);
    expect(store.processed.has("e9")).toBe(true);
  });

  it("P2: unknown plan id in a signed event is rejected", async () => {
    const store = await checkedOut();
    const body = JSON.stringify({
      event: "subscription.activated",
      payload: {
        subscription: { entity: { id: "sub_1", plan_id: "plan_zzz", notes: { user_id: "u1" } } },
      },
    });
    const res = await handleRazorpayWebhook(hook(body), deps(store));
    expect(res.status).toBe(400);
    expect(store.subscriptions.get("u1")?.status).toBe("pending");
    expect(store.processed.size).toBe(0);
  });

  it("P2: an event for another learner's subscription is acknowledged and changes nothing", async () => {
    const store = await checkedOut("u1", "sub_1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const wrongUser = event("subscription.charged", { user: "u2" });
    expect((await handleRazorpayWebhook(hook(wrongUser, { id: "e1" }), deps(store))).status).toBe(
      200,
    );
    warn.mockRestore();
    expect(store.subscriptions.get("u1")?.status).toBe("pending");
    expect(store.credits.size).toBe(0);
  });

  it("P2: an event that beats the subscription id (webhook racing subscribe) is 503 and applied on retry", async () => {
    const store = new InMemoryPaymentStore();
    const claim = await store.claimCheckout("u1", "basic"); // Razorpay created sub_1; our row has no id yet
    if (claim.kind !== "claimed") throw new Error("expected a claim");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = event("subscription.charged");

    const early = await handleRazorpayWebhook(hook(body, { id: "evt_race" }), deps(store));
    expect(early.status).toBe(503);
    expect(await early.text()).toBe("");
    expect(store.processed.has("evt_race")).toBe(false); // the event id was NOT claimed
    expect(store.credits.size).toBe(0);

    await store.attachSubscription(claim.claimId, "sub_1");
    const retry = await handleRazorpayWebhook(hook(body, { id: "evt_race" }), deps(store));
    warn.mockRestore();
    expect(retry.status).toBe(200);
    expect(store.subscriptions.get("u1")?.status).toBe("active");
    expect(store.credits.get("u1")).toBe(PAYMENT_PLANS.basic.monthlyCredits);

    // And a further replay is now a harmless duplicate.
    store.credits.set("u1", 1);
    expect((await handleRazorpayWebhook(hook(body, { id: "evt_race" }), deps(store))).status).toBe(
      200,
    );
    expect(store.credits.get("u1")).toBe(1);
  });

  it("P2: a truly unknown subscription changes nothing, claims nothing and is logged", async () => {
    const store = await checkedOut("u1", "sub_1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unknown = event("subscription.charged", { sub: "sub_other" });
    const res = await handleRazorpayWebhook(hook(unknown, { id: "e2" }), deps(store));
    const logged = warn.mock.calls.flat().map(String).join("\n");
    warn.mockRestore();
    expect(res.status).toBe(503);
    expect(logged).toContain("webhook_unknown_subscription");
    expect(logged).toContain("e2");
    expect(store.processed.size).toBe(0);
    expect(store.subscriptions.get("u1")?.status).toBe("pending");
    expect(store.credits.size).toBe(0);
  });

  it("P2: a stale subscription (replaced checkout) can no longer change plan or credits", async () => {
    const store = new InMemoryPaymentStore();
    await attach(store, "u1", "sub_old", "basic");
    // The learner switches plans: the unpaid basic checkout is closed, a new one is claimed.
    await attach(store, "u1", "sub_new", "advanced");
    const res = await handleRazorpayWebhook(
      hook(event("subscription.charged", { sub: "sub_old" }), { id: "e1" }),
      deps(store),
    );
    expect(res.status).toBe(200);
    expect(store.credits.size).toBe(0);
    expect(store.subscriptions.get("u1")?.razorpaySubscriptionId).toBe("sub_new");
    expect(store.subscriptions.get("u1")?.status).toBe("pending");
  });

  it("P2: lifecycle ordering: cancelled is terminal, and older events are ignored", async () => {
    const store = await checkedOut();
    const at = (n: number) => 1_800_000_000 + n;
    const send = (name: string, id: string, n: number) =>
      handleRazorpayWebhook(hook(event(name, { at: at(n) }), { id }), deps(store));

    await send("subscription.charged", "e1", 10);
    expect(store.subscriptions.get("u1")?.status).toBe("active");
    // Delivered late but created earlier than the charge: must not demote the subscription.
    await send("subscription.halted", "e2", 5);
    expect(store.subscriptions.get("u1")?.status).toBe("active");
    await send("subscription.cancelled", "e3", 20);
    expect(store.subscriptions.get("u1")?.status).toBe("cancelled");
    // A late charge after cancellation cannot revive it or grant credits.
    store.credits.set("u1", 0);
    await send("subscription.charged", "e4", 30);
    expect(store.subscriptions.get("u1")?.status).toBe("cancelled");
    expect(store.credits.get("u1")).toBe(0);
  });

  it("P2: a failing store returns 500 so Razorpay retries, and the event is not lost", async () => {
    const store = await checkedOut();
    const real = store.applyEvent.bind(store);
    let fail = true;
    store.applyEvent = async (input) => {
      if (fail) throw new Error("db down");
      return real(input);
    };
    const body = event("subscription.charged");
    expect((await handleRazorpayWebhook(hook(body), deps(store))).status).toBe(500);
    fail = false;
    expect((await handleRazorpayWebhook(hook(body), deps(store))).status).toBe(200);
    expect(store.credits.get("u1")).toBe(PAYMENT_PLANS.basic.monthlyCredits);
  });
});

describe("N1: subscribe route", () => {
  const signedIn: Authenticate = async (req) =>
    req.headers.get("x-test-user")
      ? { id: req.headers.get("x-test-user")!, email: "u@x.io" }
      : null;
  const post = (body: unknown, headers: Record<string, string> = { "x-test-user": "u1" }) =>
    new Request("http://x/api/razorpay/subscribe", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  const mk = (store = new InMemoryPaymentStore(), extra = {}) => ({
    keyId: "rzp_test_x",
    keySecret: "s",
    env,
    authenticate: signedIn,
    store,
    ...extra,
  });
  const okFetch = (id: string) => (async () => Response.json({ id })) as unknown as typeof fetch;

  it("N1: unauthenticated request is rejected", async () => {
    const res = await handleSubscribe(post({ planId: "basic" }, {}), mk());
    expect(res.status).toBe(401);
  });

  it("N1: the dev-only x-user-id header is not an identity", async () => {
    const res = await handleSubscribe(post({ planId: "basic" }, { "x-user-id": "u1" }), mk());
    expect(res.status).toBe(401);
  });

  it("N1: unknown fields and unknown plans are rejected by Zod", async () => {
    expect(subscribeBody.safeParse({ planId: "basic", amount: 1 }).success).toBe(false);
    expect((await handleSubscribe(post({ planId: "basic", x: 1 }), mk())).status).toBe(400);
    expect((await handleSubscribe(post({ planId: "gold" }), mk())).status).toBe(400);
    expect((await handleSubscribe(post({ planId: "starter" }), mk())).status).toBe(400);
  });

  it("P1: creates a subscription via the REST API with Basic auth and returns checkout data", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return Response.json({ id: "sub_new" });
    }) as unknown as typeof fetch;
    const res = await handleSubscribe(post({ planId: "advanced" }), mk(undefined, { fetchFn }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      subscriptionId: "sub_new",
      keyId: "rzp_test_x",
      planId: "advanced",
    });
    expect(seen?.url).toBe("https://api.razorpay.com/v1/subscriptions");
    const sent = JSON.parse(seen?.init.body as string);
    expect(sent.plan_id).toBe("plan_adv_x");
    expect(sent.notes.user_id).toBe("u1");
    expect((seen?.init.headers as Record<string, string>).authorization).toMatch(/^Basic /);
  });

  it("N1: missing keys or plan id returns a generic 503", async () => {
    const res = await handleSubscribe(
      post({ planId: "basic" }),
      mk(undefined, { keyId: undefined, keySecret: undefined }),
    );
    expect(res.status).toBe(503);
  });

  it("N1: no durable store returns a generic 503 and never calls Razorpay", async () => {
    const fetchFn = vi.fn();
    const res = await handleSubscribe(
      post({ planId: "basic" }),
      mk(undefined, { store: null, fetchFn }),
    );
    expect(res.status).toBe(503);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("P1: a double submit reuses the pending checkout instead of creating a second subscription", async () => {
    const store = new InMemoryPaymentStore();
    let creates = 0;
    const fetchFn = (async () => {
      creates++;
      return Response.json({ id: `sub_${creates}` });
    }) as unknown as typeof fetch;
    const a = await handleSubscribe(post({ planId: "basic" }), mk(store, { fetchFn }));
    const b = await handleSubscribe(post({ planId: "basic" }), mk(store, { fetchFn }));
    expect(creates).toBe(1);
    expect((await a.json()).subscriptionId).toBe("sub_1");
    expect((await b.json()).subscriptionId).toBe("sub_1");
  });

  it("P1: two concurrent submits create exactly one Razorpay subscription", async () => {
    const store = new InMemoryPaymentStore();
    let creates = 0;
    const fetchFn = (async () => {
      creates++;
      await new Promise((r) => setTimeout(r, 5));
      return Response.json({ id: `sub_${creates}` });
    }) as unknown as typeof fetch;
    const [a, b] = await Promise.all([
      handleSubscribe(post({ planId: "basic" }), mk(store, { fetchFn })),
      handleSubscribe(post({ planId: "basic" }), mk(store, { fetchFn })),
    ]);
    expect(creates).toBe(1);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it("P1: a learner with an active subscription is refused and Razorpay is not called", async () => {
    const store = await checkedOut("u1", "sub_1");
    await handleRazorpayWebhook(hook(event("subscription.activated")), deps(store));
    const fetchFn = vi.fn();
    const res = await handleSubscribe(post({ planId: "advanced" }), mk(store, { fetchFn }));
    expect(res.status).toBe(409);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("P1: switching plans before paying closes the old unpaid checkout at Razorpay", async () => {
    const store = await checkedOut("u1", "sub_old", "basic");
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      return Response.json({ id: "sub_new" });
    }) as unknown as typeof fetch;
    const res = await handleSubscribe(post({ planId: "advanced" }), mk(store, { fetchFn }));
    expect(res.status).toBe(200);
    expect(calls[0]).toBe("https://api.razorpay.com/v1/subscriptions/sub_old/cancel");
    expect(calls[1]).toBe("https://api.razorpay.com/v1/subscriptions");
    expect(store.rows.find((r) => r.razorpaySubscriptionId === "sub_old")?.status).toBe(
      "cancelled",
    );
  });

  it("P3: when Razorpay fails the claim is released so the learner can retry", async () => {
    const store = new InMemoryPaymentStore();
    const bad = (async () =>
      new Response("razorpay-internal-detail", { status: 500 })) as unknown as typeof fetch;
    const res = await handleSubscribe(post({ planId: "basic" }), mk(store, { fetchFn: bad }));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("razorpay-internal-detail");
    const retry = await handleSubscribe(
      post({ planId: "basic" }),
      mk(store, { fetchFn: okFetch("sub_ok") }),
    );
    expect(retry.status).toBe(200);
  });

  it("P1: an abandoned claim that never reached Razorpay expires and can be claimed again", async () => {
    let t = 1_000_000;
    const store = new InMemoryPaymentStore(() => t);
    expect((await store.claimCheckout("u1", "basic")).kind).toBe("claimed");
    expect((await store.claimCheckout("u1", "basic")).kind).toBe("in_progress");
    t += 3 * 60_000;
    expect((await store.claimCheckout("u1", "basic")).kind).toBe("claimed");
  });
});

describe("P4: plan config", () => {
  it("P4: credits are integers and prices are not hard-coded", () => {
    for (const p of Object.values(PAYMENT_PLANS)) {
      expect(Number.isInteger(p.monthlyCredits)).toBe(true);
      expect(p.pricePaise).toBeNull();
    }
  });

  it("C1: payment plans read their credits from lib/config, the single source of truth", () => {
    expect(PAYMENT_PLANS.basic.monthlyCredits).toBe(PLANS.basic.monthlyCredits);
    expect(PAYMENT_PLANS.advanced.monthlyCredits).toBe(PLANS.advanced.monthlyCredits);
    expect(Object.keys(PAYMENT_PLANS)).toEqual(["basic", "advanced"]);
  });

  it("P2: razorpay plan ids resolve to basic and advanced from env names", () => {
    expect(planIdFromRazorpayPlan("plan_basic_x", env)).toBe("basic");
    expect(planIdFromRazorpayPlan("plan_adv_x", env)).toBe("advanced");
    expect(planIdFromRazorpayPlan("nope", env)).toBeNull();
  });
});

describe("N1: webhook route fails closed without the durable store", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("N1: webhook route returns generic 503 when the database env is missing and changes nothing", async () => {
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const res = await webhookRoute(hook(event("subscription.charged")));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("");
  });
});

import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PAYMENT_PLANS } from "./plans";
import { verifySubscriptionCheckoutSignature, verifyWebhookSignature } from "./signature";
import { subscribeBody, handleSubscribe } from "./subscribe";
import { InMemoryPaymentStore, getPaymentStore } from "./store";
import { POST as webhookRoute } from "../../app/api/razorpay/webhook/route";
import { handleRazorpayWebhook } from "./webhook";

const SECRET = "test_webhook_secret_not_real";
const env = { RAZORPAY_PLAN_ID_BASIC: "plan_basic_x", RAZORPAY_PLAN_ID_ADVANCED: "plan_adv_x" };
const sign = (body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(body).digest("hex");

function event(name: string, planId = "plan_basic_x") {
  return JSON.stringify({
    event: name,
    payload: {
      subscription: {
        entity: { id: "sub_1", plan_id: planId, notes: { user_id: "u1", plan: "basic" } },
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
    const store = new InMemoryPaymentStore();
    const body = event("subscription.activated");
    const res = await handleRazorpayWebhook(hook(body, { sig: "deadbeef" }), deps(store));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("");
    expect(store.subscriptions.size).toBe(0);
    expect(store.credits.size).toBe(0);
    expect(store.processed.size).toBe(0);
  });

  it("P2: missing webhook secret rejects everything", async () => {
    const store = new InMemoryPaymentStore();
    const body = event("subscription.activated");
    const res = await handleRazorpayWebhook(hook(body), { store, webhookSecret: undefined, env });
    expect(res.status).toBe(400);
  });

  it("P2: activated updates status only and grants no credits", async () => {
    const store = new InMemoryPaymentStore();
    const res = await handleRazorpayWebhook(hook(event("subscription.activated")), deps(store));
    expect(res.status).toBe(200);
    expect(store.subscriptions.get("u1")?.status).toBe("active");
    expect(store.credits.size).toBe(0);
  });

  it("C4: renewal resets credits to the allowance, no rollover", async () => {
    const store = new InMemoryPaymentStore();
    store.credits.set("u1", 20);
    await handleRazorpayWebhook(hook(event("subscription.charged"), { id: "e1" }), deps(store));
    expect(store.credits.get("u1")).toBe(PAYMENT_PLANS.basic.monthlyCredits);
  });

  it("P2: charged updates plan and grants credits once; replayed event is ignored", async () => {
    const store = new InMemoryPaymentStore();
    const body = event("subscription.charged");
    expect((await handleRazorpayWebhook(hook(body), deps(store))).status).toBe(200);
    expect(store.subscriptions.get("u1")).toEqual({
      planId: "basic",
      status: "active",
      razorpaySubscriptionId: "sub_1",
    });
    expect(store.credits.get("u1")).toBe(PAYMENT_PLANS.basic.monthlyCredits);

    expect((await handleRazorpayWebhook(hook(body), deps(store))).status).toBe(200);
    expect(store.credits.get("u1")).toBe(PAYMENT_PLANS.basic.monthlyCredits);
  });

  it("C4: a second charge with a new event id resets, not accumulates", async () => {
    const store = new InMemoryPaymentStore();
    await handleRazorpayWebhook(hook(event("subscription.charged"), { id: "e1" }), deps(store));
    await handleRazorpayWebhook(hook(event("subscription.charged"), { id: "e2" }), deps(store));
    expect(store.credits.get("u1")).toBe(PAYMENT_PLANS.basic.monthlyCredits);
  });

  it("P2: cancelled and halted update status without granting credits", async () => {
    const store = new InMemoryPaymentStore();
    await handleRazorpayWebhook(hook(event("subscription.cancelled"), { id: "e1" }), deps(store));
    expect(store.subscriptions.get("u1")?.status).toBe("cancelled");
    await handleRazorpayWebhook(hook(event("subscription.halted"), { id: "e2" }), deps(store));
    expect(store.subscriptions.get("u1")?.status).toBe("halted");
    expect(store.credits.size).toBe(0);
  });

  it("P2: missing event id is rejected", async () => {
    const store = new InMemoryPaymentStore();
    const res = await handleRazorpayWebhook(
      hook(event("subscription.activated"), { id: null }),
      deps(store),
    );
    expect(res.status).toBe(400);
  });

  it("P3: payment.failed leaves plan and credits unchanged", async () => {
    const store = new InMemoryPaymentStore();
    await store.setSubscription("u1", "basic", "active", "sub_1");
    const body = JSON.stringify({ event: "payment.failed", payload: { payment: { entity: {} } } });
    const res = await handleRazorpayWebhook(hook(body, { id: "e9" }), deps(store));
    expect(res.status).toBe(200);
    expect(store.subscriptions.get("u1")?.status).toBe("active");
    expect(store.credits.size).toBe(0);
  });

  it("P2: unknown plan id in a signed event is rejected", async () => {
    const store = new InMemoryPaymentStore();
    const body = JSON.stringify({
      event: "subscription.activated",
      payload: {
        subscription: { entity: { id: "s", plan_id: "plan_zzz", notes: { user_id: "u1" } } },
      },
    });
    const res = await handleRazorpayWebhook(hook(body), deps(store));
    expect(res.status).toBe(400);
    expect(store.subscriptions.size).toBe(0);
  });
});

describe("N1: subscribe route", () => {
  const post = (body: unknown, headers: Record<string, string> = { "x-user-id": "u1" }) =>
    new Request("http://x/api/razorpay/subscribe", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  const base = { keyId: "rzp_test_x", keySecret: "s", env };

  it("N1: unauthenticated request is rejected", async () => {
    const res = await handleSubscribe(post({ planId: "basic" }, {}), base);
    expect(res.status).toBe(401);
  });

  it("N1: unknown fields and unknown plans are rejected by Zod", async () => {
    expect(subscribeBody.safeParse({ planId: "basic", amount: 1 }).success).toBe(false);
    expect((await handleSubscribe(post({ planId: "basic", x: 1 }), base)).status).toBe(400);
    expect((await handleSubscribe(post({ planId: "gold" }), base)).status).toBe(400);
  });

  it("P1: creates a subscription via the REST API with Basic auth and returns checkout data", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return Response.json({ id: "sub_new" });
    }) as unknown as typeof fetch;
    const res = await handleSubscribe(post({ planId: "advanced" }), { ...base, fetchFn });
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
    const res = await handleSubscribe(post({ planId: "basic" }), {
      keyId: undefined,
      keySecret: undefined,
      env,
    });
    expect(res.status).toBe(503);
  });
});

describe("P4: plan config", () => {
  it("P4: credits are integers and prices are not hard-coded", () => {
    for (const p of Object.values(PAYMENT_PLANS)) {
      expect(Number.isInteger(p.monthlyCredits)).toBe(true);
      expect(p.pricePaise).toBeNull();
    }
  });
});

describe("N1: fail closed in production until M5", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("N1: x-user-id is honoured outside production and ignored in production", async () => {
    const req = () =>
      new Request("http://x/s", {
        method: "POST",
        headers: { "x-user-id": "u1" },
        body: JSON.stringify({ planId: "gold" }),
      });
    const base = { keyId: "k", keySecret: "s", env };
    vi.stubEnv("NODE_ENV", "development");
    expect((await handleSubscribe(req(), base)).status).toBe(400); // got past auth
    vi.stubEnv("NODE_ENV", "production");
    const res = await handleSubscribe(req(), base);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign in required" });
  });

  it("N1: webhook route returns generic 503 in production and changes nothing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", SECRET);
    expect(getPaymentStore()).toBeNull();
    const res = await webhookRoute(hook(event("subscription.charged")));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("");
  });
});

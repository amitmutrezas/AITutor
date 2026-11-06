import { describe, expect, it } from "vitest";
import type { Authenticate } from "../auth/types";
import { handleMockCheckout, handleMockConfirm, type MockPaymentsDeps } from "./mock";
import { paymentsMode } from "./mode";
import { PAYMENT_PLANS } from "./plans";
import { InMemoryPaymentStore } from "./store";

const MOCK = { PAYMENTS_MODE: "mock" };
const as =
  (id: string | null): Authenticate =>
  async () =>
    id ? { id, email: `${id}@example.test` } : null;

const post = (path: string, body: unknown) =>
  new Request(`http://x${path}`, { method: "POST", body: JSON.stringify(body) });

function setup(over: Partial<MockPaymentsDeps> = {}) {
  const store = new InMemoryPaymentStore();
  const deps: MockPaymentsDeps = {
    authenticate: as("u1"),
    store,
    env: MOCK,
    newId: () => "fixed",
    ...over,
  };
  return { store, deps };
}

describe("P1: payments mode switch", () => {
  it("P1: unset means the real Razorpay path, also when NODE_ENV is production", () => {
    expect(paymentsMode({})).toBe("razorpay");
    expect(paymentsMode({ NODE_ENV: "production" })).toBe("razorpay");
    expect(paymentsMode({ PAYMENTS_MODE: "" })).toBe("razorpay");
    expect(paymentsMode({ PAYMENTS_MODE: "razorpay" })).toBe("razorpay");
  });
  it("P1: mock needs the exact value, in production too, and nothing else enables it", () => {
    expect(paymentsMode({ PAYMENTS_MODE: "mock", NODE_ENV: "production" })).toBe("mock");
    for (const v of ["Mock", "true", "1", "mock ", "test", "mok"]) {
      expect(paymentsMode({ PAYMENTS_MODE: v, NODE_ENV: "production" }), v).toBe("off");
    }
  });
  it("P1: mock is refused when a live Razorpay key is configured", () => {
    expect(paymentsMode({ PAYMENTS_MODE: "mock", RAZORPAY_KEY_ID: "rzp_live_abc" })).toBe("off");
    expect(paymentsMode({ PAYMENTS_MODE: "mock", RAZORPAY_KEY_ID: "rzp_test_abc" })).toBe("mock");
  });
});

describe("P1: mock checkout is off unless mode is mock (fail closed)", () => {
  it.each([{}, { PAYMENTS_MODE: "razorpay" }, { PAYMENTS_MODE: "mok" }])(
    "P1: %j answers 503 on both mock routes",
    async (env) => {
      const { deps } = setup({ env });
      const a = await handleMockCheckout(post("/c", { planId: "basic" }), deps);
      const b = await handleMockConfirm(post("/c", { planId: "basic" }), deps);
      expect([a.status, b.status]).toEqual([503, 503]);
      expect(await deps.store?.liveSubscription("u1")).toBeNull();
    },
  );
  it("P1: answers 503 without a store", async () => {
    const { deps } = setup({ store: null });
    expect((await handleMockCheckout(post("/c", { planId: "basic" }), deps)).status).toBe(503);
  });
});

describe("P1/P2: mock checkout then confirm applies plan and credits through the store", () => {
  it("P1: signed-out requests get 401 and change nothing", async () => {
    const { store, deps } = setup({ authenticate: as(null) });
    expect((await handleMockCheckout(post("/c", { planId: "basic" }), deps)).status).toBe(401);
    expect((await handleMockConfirm(post("/c", { planId: "basic" }), deps)).status).toBe(401);
    expect(store.rows).toHaveLength(0);
  });

  it("P1: validates the body with Zod (unknown plan, extra field)", async () => {
    const { deps } = setup();
    expect((await handleMockCheckout(post("/c", { planId: "gold" }), deps)).status).toBe(400);
    expect(
      (await handleMockCheckout(post("/c", { planId: "basic", credits: 999 }), deps)).status,
    ).toBe(400);
    expect((await handleMockConfirm(post("/c", {}), deps)).status).toBe(400);
  });

  it("P1: checkout alone creates a pending row and grants nothing", async () => {
    const { store, deps } = setup();
    const res = await handleMockCheckout(post("/c", { planId: "basic" }), deps);
    expect(res.status).toBe(200);
    expect(await store.liveSubscription("u1")).toMatchObject({
      status: "pending",
      planId: "basic",
      razorpaySubscriptionId: "mock_sub_fixed",
    });
    expect(store.credits.get("u1")).toBeUndefined();
  });

  it("P2: confirm activates the plan and sets credits from config", async () => {
    const { store, deps } = setup();
    await handleMockCheckout(post("/c", { planId: "advanced" }), deps);
    const res = await handleMockConfirm(post("/c", { planId: "advanced" }), deps);
    expect(res.status).toBe(200);
    expect(await store.liveSubscription("u1")).toMatchObject({
      status: "active",
      planId: "advanced",
    });
    expect(store.credits.get("u1")).toBe(PAYMENT_PLANS.advanced.monthlyCredits);
  });

  it("P2: confirming twice is idempotent (credits are not granted twice)", async () => {
    const { store, deps } = setup();
    await handleMockCheckout(post("/c", { planId: "basic" }), deps);
    await handleMockConfirm(post("/c", { planId: "basic" }), deps);
    store.credits.set("u1", 7); // spent some credits in between
    const again = await handleMockConfirm(post("/c", { planId: "basic" }), deps);
    expect(again.status).toBe(200);
    expect(store.credits.get("u1")).toBe(7);
  });

  it("P2: a replayed event id is a duplicate even if the row were still pending", async () => {
    const { store, deps } = setup();
    await handleMockCheckout(post("/c", { planId: "basic" }), deps);
    await handleMockConfirm(post("/c", { planId: "basic" }), deps);
    expect(store.processed.has("mock_sub_fixed:activated")).toBe(true);
    expect(store.processed.has("mock_sub_fixed:charged")).toBe(true);
  });

  it("P1: confirm without a started test checkout is refused", async () => {
    const { store, deps } = setup();
    expect((await handleMockConfirm(post("/c", { planId: "basic" }), deps)).status).toBe(409);
    expect(store.credits.size).toBe(0);
  });

  it("P1: confirm for a different plan than the pending checkout is refused", async () => {
    const { store, deps } = setup();
    await handleMockCheckout(post("/c", { planId: "basic" }), deps);
    expect((await handleMockConfirm(post("/c", { planId: "advanced" }), deps)).status).toBe(409);
    expect((await store.liveSubscription("u1"))?.status).toBe("pending");
  });

  it("P1: confirm never touches a real Razorpay checkout", async () => {
    const { store, deps } = setup();
    const claim = await store.claimCheckout("u1", "basic");
    if (claim.kind !== "claimed") throw new Error("claim");
    await store.attachSubscription(claim.claimId, "sub_real_123");
    expect((await handleMockConfirm(post("/c", { planId: "basic" }), deps)).status).toBe(409);
    expect(store.credits.size).toBe(0);
    expect((await handleMockCheckout(post("/c", { planId: "advanced" }), deps)).status).toBe(409);
  });

  it("P1: a learner cannot confirm another learner's checkout", async () => {
    const { store, deps } = setup();
    await handleMockCheckout(post("/c", { planId: "basic" }), deps);
    const other = { ...deps, authenticate: as("u2") };
    expect((await handleMockConfirm(post("/c", { planId: "basic" }), other)).status).toBe(409);
    expect(store.credits.size).toBe(0);
  });

  it("P1: starting checkout again reuses the pending one, switching plan closes the old one", async () => {
    const { store, deps } = setup();
    await handleMockCheckout(post("/c", { planId: "basic" }), deps);
    expect((await handleMockCheckout(post("/c", { planId: "basic" }), deps)).status).toBe(200);
    expect((await handleMockCheckout(post("/c", { planId: "advanced" }), deps)).status).toBe(200);
    expect((await store.liveSubscription("u1"))?.planId).toBe("advanced");
  });

  it("P1: a learner with an active plan cannot start another checkout", async () => {
    const { deps } = setup();
    await handleMockCheckout(post("/c", { planId: "basic" }), deps);
    await handleMockConfirm(post("/c", { planId: "basic" }), deps);
    expect((await handleMockCheckout(post("/c", { planId: "advanced" }), deps)).status).toBe(409);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { Authenticate } from "../auth/types";
import { InMemoryCredits } from "../credits";
import { InMemoryHintLog } from "../hints/hint-log";
import { InMemoryPaymentStore } from "../payments/store";
import { InMemorySavedCode } from "../saved-code/service";
import { createAccountHandlers } from "./handler";
import { InMemoryAccounts } from "./service";

const auth: Authenticate = async (req) => {
  const id = req.headers.get("x-test-user");
  return id ? { id, email: `${id}@example.com` } : null;
};

async function setup(opts: { fetchFn?: typeof fetch; liveSub?: "pending" | "active" } = {}) {
  const savedCode = new InMemorySavedCode();
  const hintLog = new InMemoryHintLog();
  const credits = new InMemoryCredits({ u1: 12 });
  await savedCode.save("u1", "sum-array", "code");
  await hintLog.record({
    userId: "u1",
    exerciseId: "sum-array",
    level: 3,
    codeHash: "h",
    tokensIn: 1,
    tokensOut: 1,
    fallback: false,
  });
  const accounts = new InMemoryAccounts(
    { u1: { email: "u1@example.com", planKey: "basic", balance: 12 } },
    {
      onDelete: async (id) => {
        await savedCode.deleteAll(id);
        hintLog.entries.splice(
          0,
          hintLog.entries.length,
          ...hintLog.entries.filter((e) => e.userId !== id),
        );
        credits.balances.delete(id);
      },
    },
  );
  const payments = new InMemoryPaymentStore();
  if (opts.liveSub) {
    const claim = await payments.claimCheckout("u1", "basic");
    if (claim.kind === "claimed") await payments.attachSubscription(claim.claimId, "sub_1");
    if (opts.liveSub === "active") {
      await payments.applyEvent({
        eventId: "e0",
        kind: "subscription",
        userId: "u1",
        planId: "basic",
        razorpaySubscriptionId: "sub_1",
        status: "active",
      });
    }
  }
  const h = createAccountHandlers({
    authenticate: auth,
    accounts,
    payments,
    keyId: "k",
    keySecret: "s",
    fetchFn: opts.fetchFn,
  });
  return { h, savedCode, hintLog, credits, accounts };
}
const req = (method: string, body?: unknown, user: string | null = "u1") =>
  new Request("http://x/api/account", {
    method,
    headers: user ? { "x-test-user": user } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const confirm = { confirm: "delete my account" };

describe("A2: account summary", () => {
  it("A2: requires sign-in", async () => {
    const { h } = await setup();
    expect((await h.GET(req("GET", undefined, null))).status).toBe(401);
  });

  it("A2: lists plan and credits from the server, with plan names from config", async () => {
    const { h } = await setup();
    expect(await (await h.GET(req("GET"))).json()).toEqual({
      email: "u1@example.com",
      plan: { id: "basic", name: "Basic", monthlyCredits: 30 },
      credits: 12,
    });
  });
});

describe("A3: delete account", () => {
  it("A3: requires sign-in and an explicit confirmation phrase", async () => {
    const { h, accounts } = await setup();
    expect((await h.DELETE(req("DELETE", confirm, null))).status).toBe(401);
    expect((await h.DELETE(req("DELETE", {}))).status).toBe(400);
    expect((await h.DELETE(req("DELETE", { confirm: "yes" }))).status).toBe(400);
    expect((await h.DELETE(req("DELETE", { ...confirm, extra: 1 }))).status).toBe(400);
    expect(await accounts.get("u1")).not.toBeNull();
  });

  it("A3: deleting the account removes saved code, hint log and credits", async () => {
    const { h, accounts, savedCode, hintLog, credits } = await setup();
    const res = await h.DELETE(req("DELETE", confirm));
    expect(res.status).toBe(200);
    expect(await accounts.get("u1")).toBeNull();
    expect(await savedCode.list("u1")).toEqual([]);
    expect(hintLog.entries).toEqual([]);
    expect(await credits.balance("u1")).toBe(0);
  });

  it("A3: an active subscription is cancelled at Razorpay before the account is deleted", async () => {
    const fetchFn = vi.fn(async () => Response.json({}));
    const { h, accounts } = await setup({
      liveSub: "active",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect((await h.DELETE(req("DELETE", confirm))).status).toBe(200);
    expect((fetchFn.mock.calls as unknown as string[][])[0][0]).toBe(
      "https://api.razorpay.com/v1/subscriptions/sub_1/cancel",
    );
    expect(await accounts.get("u1")).toBeNull();
  });

  it("A3: if the subscription cannot be cancelled the account is kept, so nobody is billed after deletion", async () => {
    const fetchFn = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
    const { h, accounts, savedCode } = await setup({ liveSub: "active", fetchFn });
    const res = await h.DELETE(req("DELETE", confirm));
    expect(res.status).toBe(502);
    expect(await accounts.get("u1")).not.toBeNull();
    expect(await savedCode.list("u1")).toHaveLength(1);
  });

  it("A3: an unpaid pending checkout does not block deletion", async () => {
    const fetchFn = (async () => new Response("x", { status: 400 })) as unknown as typeof fetch;
    const { h, accounts } = await setup({ liveSub: "pending", fetchFn });
    expect((await h.DELETE(req("DELETE", confirm))).status).toBe(200);
    expect(await accounts.get("u1")).toBeNull();
  });
});

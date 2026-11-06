import { describe, expect, it, vi } from "vitest";
import type { Authenticate } from "../auth/types";
import { InMemoryCredits } from "../credits";
import { InMemoryHintLog } from "../hints/hint-log";
import { InMemoryPaymentStore } from "../payments/store";
import { InMemorySavedCode } from "../saved-code/service";
import { createAccountHandlers } from "./handler";
import { createSupabaseAccounts, InMemoryAccounts } from "./service";

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
  const payments = new InMemoryPaymentStore();
  const accounts = new InMemoryAccounts(
    { u1: { email: "u1@example.com", planKey: "basic", balance: 12 } },
    {
      payments,
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
    keyId: "k",
    keySecret: "s",
    fetchFn: opts.fetchFn,
  });
  return { h, savedCode, hintLog, credits, accounts, payments };
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

  it("A3: a failed cancel blocks deletion for ANY row with a Razorpay subscription id, including pending", async () => {
    const fetchFn = (async () => new Response("x", { status: 400 })) as unknown as typeof fetch;
    const { h, accounts, savedCode } = await setup({ liveSub: "pending", fetchFn });
    const res = await h.DELETE(req("DELETE", confirm));
    expect(res.status).toBe(502);
    expect(await accounts.get("u1")).not.toBeNull();
    expect(await savedCode.list("u1")).toHaveLength(1);
  });

  it("A3: a pending row that never reached Razorpay (no id) has nothing to cancel and does not block", async () => {
    const fetchFn = vi.fn();
    const { h, accounts, payments } = await setup({ fetchFn: fetchFn as unknown as typeof fetch });
    await payments.claimCheckout("u1", "basic"); // claimed, id never attached
    expect((await h.DELETE(req("DELETE", confirm))).status).toBe(200);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await accounts.get("u1")).toBeNull();
  });

  it("A3: retrying after a delete failed, when Razorpay already cancelled the subscription, succeeds", async () => {
    const fetchFn = (async (url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response("already cancelled", { status: 400 })
        : Response.json({ status: "cancelled" })) as unknown as typeof fetch;
    const { h, accounts } = await setup({ liveSub: "active", fetchFn });
    expect((await h.DELETE(req("DELETE", confirm))).status).toBe(200);
    expect(await accounts.get("u1")).toBeNull();
  });

  it("A3/P1: a checkout cannot start while deletion is in progress, including during the Razorpay cancel", async () => {
    let duringCancel: string | undefined;
    const ref: { payments?: InMemoryPaymentStore } = {};
    const fetchFn = (async () => {
      // The deleting marker is already set when the cancel call is made.
      duringCancel = (await ref.payments!.claimCheckout("u1", "advanced")).kind;
      return Response.json({});
    }) as unknown as typeof fetch;
    const { h, accounts, payments } = await setup({ liveSub: "active", fetchFn });
    ref.payments = payments;
    expect((await h.DELETE(req("DELETE", confirm))).status).toBe(200);
    expect(duringCancel).toBe("account_deleting");
    expect(await accounts.get("u1")).toBeNull();
    expect(payments.rows).toHaveLength(0); // no checkout slipped in before the cascade
  });

  it("A3/P1: a subscription claimed before deletion began is seen and cancelled; one attached after is refused", async () => {
    const { h, payments } = await setup({
      fetchFn: (async () => Response.json({})) as unknown as typeof fetch,
    });
    const claim = await payments.claimCheckout("u1", "basic"); // checkout in flight, id not attached yet
    if (claim.kind !== "claimed") throw new Error("expected claim");
    expect((await h.DELETE(req("DELETE", confirm))).status).toBe(200);
    // The in-flight request now tries to attach its new Razorpay subscription: refused (row gone / deleting).
    expect(await payments.attachSubscription(claim.claimId, "sub_late")).toBe(false);
  });

  it("A3: when the cancel fails the deleting marker is cleared so checkout works again", async () => {
    const fetchFn = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
    const { h, payments, accounts } = await setup({ liveSub: "active", fetchFn });
    expect((await h.DELETE(req("DELETE", confirm))).status).toBe(502);
    expect(payments.deleting.has("u1")).toBe(false);
    expect(await accounts.get("u1")).not.toBeNull();
  });

  it("A3: an unknown account is a 404 and sets no marker", async () => {
    const { h, payments } = await setup();
    const r = new Request("http://x/api/account", {
      method: "DELETE",
      headers: { "x-test-user": "ghost" },
      body: JSON.stringify(confirm),
    });
    expect((await h.DELETE(r)).status).toBe(404);
    expect(payments.deleting.size).toBe(0);
  });

  it("A3/P1: a second DELETE while one is in progress gets 409 and cannot clear the first one's marker", async () => {
    const ref: { h?: Awaited<ReturnType<typeof setup>>["h"] } = {};
    let second = 0;
    let markerAfterSecond: boolean | undefined;
    const ref2: { payments?: InMemoryPaymentStore } = {};
    const fetchFn = (async () => {
      // The first request is at its Razorpay cancel (which fails); a second DELETE overlaps it.
      second = (await ref.h!.DELETE(req("DELETE", confirm))).status;
      markerAfterSecond = ref2.payments!.deleting.has("u1");
      return new Response("x", { status: 500 });
    }) as unknown as typeof fetch;
    const { h, payments, accounts } = await setup({ liveSub: "active", fetchFn });
    ref.h = h;
    ref2.payments = payments;
    expect((await h.DELETE(req("DELETE", confirm))).status).toBe(502);
    expect(second).toBe(409);
    expect(markerAfterSecond).toBe(true); // still blocking checkout while the first attempt is working
    expect(payments.deleting.has("u1")).toBe(false); // the owner cleared its own marker
    expect(await accounts.get("u1")).not.toBeNull();
  });

  it("A3/P1: cancelDeletion is compare-and-set on the token", async () => {
    const { accounts, payments } = await setup();
    const a = await accounts.beginDeletion("u1");
    if (!a || a.inProgress) throw new Error("expected to begin");
    expect(await accounts.beginDeletion("u1")).toEqual({ inProgress: true });
    expect(await accounts.cancelDeletion("u1", "tok_other")).toBe(false);
    expect(payments.deleting.has("u1")).toBe(true);
    await expect(accounts.delete("u1", "tok_other")).rejects.toThrow();
    expect(await accounts.cancelDeletion("u1", a.token)).toBe(true);
    expect(payments.deleting.has("u1")).toBe(false);
    expect(await accounts.cancelDeletion("u1", a.token)).toBe(false); // already cleared
  });

  it("A3/P1: the Supabase adapter parses in_progress and passes the token to cancel and delete", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const data: Record<string, unknown> = {
      account_begin_delete: { in_progress: true },
      account_cancel_delete: false,
      account_delete: null,
    };
    const client = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push([fn, args]);
        return { data: data[fn], error: null };
      },
    };
    const a = createSupabaseAccounts(client);
    expect(await a.beginDeletion("u")).toEqual({ inProgress: true });
    expect(await a.cancelDeletion("u", "t1")).toBe(false);
    await a.delete("u", "t1");
    expect(calls[1]).toEqual(["account_cancel_delete", { p_user: "u", p_token: "t1" }]);
    expect(calls[2]).toEqual(["account_delete", { p_user: "u", p_token: "t1" }]);
  });
});

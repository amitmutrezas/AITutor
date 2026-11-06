import { describe, expect, it } from "vitest";
import { CREDIT_COST_BY_LEVEL, CREDITS } from "../config";
import { RpcError, type RpcClient } from "../db/rpc";
import { InMemoryCredits, createSupabaseCredits } from "./index";

const entry = {
  exerciseId: "sum-array",
  level: 3,
  codeHash: "a".repeat(64),
  tokensIn: 1,
  tokensOut: 2,
  fallback: false,
};

function recordingRpc(
  result: (fn: string) => { data: unknown; error: { message: string } | null },
) {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  const client: RpcClient = {
    async rpc(fn, args) {
      calls.push({ fn, args });
      return result(fn);
    },
  };
  return { client, calls };
}

describe("C2: credits port (in-memory fake)", () => {
  it("C2: refused when insufficient credits, and nothing is taken", async () => {
    const credits = new InMemoryCredits({ u1: 1 });
    expect(await credits.reserve("u1", 2)).toBeNull();
    expect(await credits.balance("u1")).toBe(1);
    expect(credits.ledger).toEqual([]);
  });

  it("C2: a user with no credits row has a zero balance and cannot reserve", async () => {
    const credits = new InMemoryCredits();
    expect(await credits.balance("nobody")).toBe(0);
    expect(await credits.reserve("nobody", 1)).toBeNull();
  });

  it("C2: costs per level come from config and can all be reserved exactly", async () => {
    const credits = new InMemoryCredits({ u1: 3 });
    const paid = CREDIT_COST_BY_LEVEL.filter((c) => c > 0);
    expect(paid).toEqual([1, 2, 3]);
    expect(await credits.reserve("u1", paid[2])).not.toBeNull();
    expect(await credits.balance("u1")).toBe(0);
    expect(await credits.reserve("u1", 1)).toBeNull();
  });

  it("C2: concurrent reservations never take the balance below zero", async () => {
    const credits = new InMemoryCredits({ u1: 3 });
    const results = await Promise.all(Array.from({ length: 10 }, () => credits.reserve("u1", 1)));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(await credits.balance("u1")).toBe(0);
  });

  it("C3: release gives back exactly what was reserved, once (idempotent)", async () => {
    const credits = new InMemoryCredits({ u1: 5 });
    const r = (await credits.reserve("u1", 3))!;
    expect(await credits.release(r.id)).toBe(true);
    expect(await credits.release(r.id)).toBe(false);
    expect(await credits.balance("u1")).toBe(5);
    expect(credits.ledger.map((e) => e.delta)).toEqual([-3, 3]);
  });

  it("C3: a settled reservation cannot be released or reconciled away", async () => {
    let t = 0;
    const credits = new InMemoryCredits({ u1: 5 }, { now: () => t });
    const r = (await credits.reserve("u1", 2))!;
    expect(await credits.settle(r.id, entry)).toBe(true);
    expect(await credits.release(r.id)).toBe(false);
    t += CREDITS.reservationTimeoutSeconds * 1000 * 2;
    expect(await credits.reconcile()).toBe(0);
    expect(await credits.balance("u1")).toBe(3);
  });

  it("C3: a settle that throws changes nothing, so the reservation can still be released", async () => {
    const credits = new InMemoryCredits(
      { u1: 5 },
      {
        onSettle: () => {
          throw new Error("log insert failed");
        },
      },
    );
    const r = (await credits.reserve("u1", 2))!;
    await expect(credits.settle(r.id, entry)).rejects.toThrow();
    expect(await credits.release(r.id)).toBe(true);
    expect(await credits.balance("u1")).toBe(5);
  });

  it("3.2: reconcile releases only stale open reservations", async () => {
    let t = 0;
    const credits = new InMemoryCredits({ u1: 5, u2: 5 }, { now: () => t });
    await credits.reserve("u1", 2);
    t += CREDITS.reservationTimeoutSeconds * 1000;
    await credits.reserve("u2", 1); // fresh
    expect(await credits.reconcile()).toBe(1);
    expect(await credits.balance("u1")).toBe(5);
    expect(await credits.balance("u2")).toBe(4);
  });

  it("C2: credits are integers: zero, negative and fractional amounts are rejected", async () => {
    const credits = new InMemoryCredits({ u1: 5 });
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      await expect(credits.reserve("u1", bad)).rejects.toThrow(RangeError);
    }
    expect(await credits.balance("u1")).toBe(5);
  });

  it("C4: reset replaces the balance (no rollover) and records the difference", () => {
    const credits = new InMemoryCredits({ u1: 20 });
    credits.reset("u1", 30, "subscription_renewal");
    expect(credits.balances.get("u1")).toBe(30);
    expect(credits.ledger).toEqual([{ userId: "u1", delta: 10, reason: "subscription_renewal" }]);
  });
});

describe("C2: credits port (Supabase adapter)", () => {
  it("C2: reserve calls the atomic SQL function with the config timeout and returns the reservation", async () => {
    const { client, calls } = recordingRpc(() => ({ data: "res-uuid", error: null }));
    expect(await createSupabaseCredits(client).reserve("u1", 2)).toEqual({ id: "res-uuid" });
    expect(calls).toEqual([
      {
        fn: "credits_reserve",
        args: { p_user: "u1", p_cost: 2, p_timeout_seconds: CREDITS.reservationTimeoutSeconds },
      },
    ]);
  });

  it("C2: a null result from the database means refused", async () => {
    const { client } = recordingRpc(() => ({ data: null, error: null }));
    expect(await createSupabaseCredits(client).reserve("u1", 2)).toBeNull();
  });

  it("C3: release, settle, reconcile and balance map to their SQL functions", async () => {
    const { client, calls } = recordingRpc((fn) => ({
      data: {
        credits_release: true,
        credits_settle_hint: true,
        credits_reconcile: 2,
        credits_get_balance: 7,
      }[fn],
      error: null,
    }));
    const credits = createSupabaseCredits(client);
    expect(await credits.release("r1")).toBe(true);
    expect(await credits.settle("r1", entry)).toBe(true);
    expect(await credits.reconcile()).toBe(2);
    expect(await credits.balance("u1")).toBe(7);
    expect(calls.map((c) => c.fn)).toEqual([
      "credits_release",
      "credits_settle_hint",
      "credits_reconcile",
      "credits_get_balance",
    ]);
    expect(calls[1].args).toEqual({
      p_reservation: "r1",
      p_exercise: "sum-array",
      p_level: 3,
      p_code_hash: "a".repeat(64),
      p_tokens_in: 1,
      p_tokens_out: 2,
      p_fallback: false,
    });
  });

  it("C2: invalid amounts never reach the database", async () => {
    const { client, calls } = recordingRpc(() => ({ data: "x", error: null }));
    await expect(createSupabaseCredits(client).reserve("u1", 0)).rejects.toThrow(RangeError);
    expect(calls).toEqual([]);
  });

  it("C2: a database error becomes a generic RpcError with no SQL or arguments in it", async () => {
    const { client } = recordingRpc(() => ({
      data: null,
      error: { message: 'duplicate key value violates constraint "secret_table_pkey"' },
    }));
    const err = await createSupabaseCredits(client)
      .reserve("u1", 1)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect(String((err as Error).message)).not.toContain("secret_table");
    expect(String((err as Error).message)).not.toContain("u1");
  });

  it("C3: an unexpected result shape fails closed (settle does not report success)", async () => {
    const { client } = recordingRpc(() => ({ data: "yes", error: null }));
    await expect(createSupabaseCredits(client).settle("r1", entry)).rejects.toThrow(RpcError);
  });
});

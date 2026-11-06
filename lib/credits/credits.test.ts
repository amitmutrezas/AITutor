import { describe, expect, it } from "vitest";
import { CREDIT_COST_BY_LEVEL } from "../config";
import { RpcError, type RpcClient } from "../db/rpc";
import { InMemoryCredits, createSupabaseCredits } from "./index";

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
    expect(await credits.reserve("u1", 2)).toBe(false);
    expect(await credits.balance("u1")).toBe(1);
    expect(credits.ledger).toEqual([]);
  });

  it("C2: a user with no credits row has a zero balance and cannot reserve", async () => {
    const credits = new InMemoryCredits();
    expect(await credits.balance("nobody")).toBe(0);
    expect(await credits.reserve("nobody", 1)).toBe(false);
  });

  it("C2: costs per level come from config and can all be reserved exactly", async () => {
    const credits = new InMemoryCredits({ u1: 3 });
    const paid = CREDIT_COST_BY_LEVEL.filter((c) => c > 0);
    expect(paid).toEqual([1, 2, 3]);
    expect(await credits.reserve("u1", paid[2])).toBe(true);
    expect(await credits.balance("u1")).toBe(0);
    expect(await credits.reserve("u1", 1)).toBe(false);
  });

  it("C2: concurrent reservations never take the balance below zero", async () => {
    const credits = new InMemoryCredits({ u1: 3 });
    const results = await Promise.all(Array.from({ length: 10 }, () => credits.reserve("u1", 1)));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(await credits.balance("u1")).toBe(0);
  });

  it("C3: release gives back exactly what was reserved, and both are in the ledger", async () => {
    const credits = new InMemoryCredits({ u1: 5 });
    await credits.reserve("u1", 3);
    await credits.release("u1", 3);
    expect(await credits.balance("u1")).toBe(5);
    expect(credits.ledger.map((e) => e.delta)).toEqual([-3, 3]);
  });

  it("C2: credits are integers: zero, negative and fractional amounts are rejected", async () => {
    const credits = new InMemoryCredits({ u1: 5 });
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      await expect(credits.reserve("u1", bad)).rejects.toThrow(RangeError);
      await expect(credits.release("u1", bad)).rejects.toThrow(RangeError);
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
  it("C2: reserve calls the atomic SQL function and returns its boolean", async () => {
    const { client, calls } = recordingRpc(() => ({ data: false, error: null }));
    const credits = createSupabaseCredits(client);
    expect(await credits.reserve("u1", 2)).toBe(false);
    expect(calls).toEqual([{ fn: "credits_reserve", args: { p_user: "u1", p_cost: 2 } }]);
  });

  it("C3: release and balance map to their SQL functions", async () => {
    const { client, calls } = recordingRpc((fn) => ({
      data: fn === "credits_get_balance" ? 7 : null,
      error: null,
    }));
    const credits = createSupabaseCredits(client);
    await credits.release("u1", 1);
    expect(await credits.balance("u1")).toBe(7);
    expect(calls.map((c) => c.fn)).toEqual(["credits_release", "credits_get_balance"]);
  });

  it("C2: invalid amounts never reach the database", async () => {
    const { client, calls } = recordingRpc(() => ({ data: true, error: null }));
    const credits = createSupabaseCredits(client);
    await expect(credits.reserve("u1", 0)).rejects.toThrow(RangeError);
    await expect(credits.release("u1", 1.5)).rejects.toThrow(RangeError);
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

  it("C2: an unexpected result shape fails closed instead of reserving", async () => {
    const { client } = recordingRpc(() => ({ data: "yes", error: null }));
    await expect(createSupabaseCredits(client).reserve("u1", 1)).rejects.toThrow(RpcError);
  });
});

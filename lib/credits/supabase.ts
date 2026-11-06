import { z } from "zod";
import { callRpc, type RpcClient } from "../db/rpc";
import { assertCost, type CreditsPort } from "./types";

/**
 * Postgres-backed CreditsPort. Each call is one SQL function (credits_reserve, credits_release,
 * credits_get_balance) that runs in its own transaction: the balance change and its ledger row
 * commit together or not at all, and reserve is a single conditional UPDATE, so two concurrent
 * requests cannot both spend the last credit (C2, POLICY 3.1).
 */
export function createSupabaseCredits(db: RpcClient): CreditsPort {
  return {
    reserve: async (userId, cost) => {
      assertCost(cost);
      return await callRpc(db, "credits_reserve", { p_user: userId, p_cost: cost }, z.boolean());
    },
    release: async (userId, cost) => {
      assertCost(cost);
      await callRpc(db, "credits_release", { p_user: userId, p_cost: cost }, z.unknown());
    },
    balance: (userId) =>
      callRpc(db, "credits_get_balance", { p_user: userId }, z.number().int().nonnegative()),
  };
}

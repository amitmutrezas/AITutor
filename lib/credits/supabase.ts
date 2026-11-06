import { z } from "zod";
import { CREDITS } from "../config";
import { callRpc, type RpcClient } from "../db/rpc";
import { assertCost, type CreditsPort } from "./types";

/**
 * Postgres-backed CreditsPort. Each call is one SQL function that runs in its own transaction:
 * credits_reserve is a single conditional UPDATE plus a reservation row (two concurrent requests
 * cannot both spend the last credit), credits_release is idempotent, credits_settle_hint writes the
 * hash-only hint log and marks the reservation settled together, and credits_reconcile gives back
 * reservations nobody resolved (C2, C3, POLICY 3.1, 3.2).
 */
export function createSupabaseCredits(db: RpcClient): CreditsPort {
  const timeout = CREDITS.reservationTimeoutSeconds;
  return {
    reserve: async (userId, cost) => {
      assertCost(cost);
      const id = await callRpc(
        db,
        "credits_reserve",
        { p_user: userId, p_cost: cost, p_timeout_seconds: timeout },
        z.string().nullable(),
      );
      return id ? { id } : null;
    },
    release: (reservationId) =>
      callRpc(db, "credits_release", { p_reservation: reservationId }, z.boolean()),
    settle: (reservationId, e) =>
      callRpc(
        db,
        "credits_settle_hint",
        {
          p_reservation: reservationId,
          p_exercise: e.exerciseId,
          p_level: e.level,
          p_code_hash: e.codeHash,
          p_tokens_in: e.tokensIn,
          p_tokens_out: e.tokensOut,
          p_fallback: e.fallback,
        },
        z.boolean(),
      ),
    reconcile: () =>
      callRpc(
        db,
        "credits_reconcile",
        { p_timeout_seconds: timeout },
        z.number().int().nonnegative(),
      ),
    balance: (userId) =>
      callRpc(db, "credits_get_balance", { p_user: userId }, z.number().int().nonnegative()),
  };
}

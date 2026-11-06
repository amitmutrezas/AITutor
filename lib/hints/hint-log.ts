import { z } from "zod";
import { callRpc, type RpcClient } from "../db/rpc";
import type { HintLevel } from "./types";

/**
 * One row per hint request (POLICY 2.1, N2, N3). There is deliberately no field that can carry
 * learner code: only its sha256.
 */
export interface HintLogEntry {
  userId: string;
  exerciseId: string;
  level: HintLevel;
  /** sha256 of the learner code (N3). */
  codeHash: string;
  tokensIn: number;
  tokensOut: number;
  fallback: boolean;
}

export interface HintLogPort {
  record(entry: HintLogEntry): Promise<void>;
}

export class InMemoryHintLog implements HintLogPort {
  readonly entries: HintLogEntry[] = [];
  async record(entry: HintLogEntry): Promise<void> {
    // Copy only the known columns so nothing extra can ride along.
    const { userId, exerciseId, level, codeHash, tokensIn, tokensOut, fallback } = entry;
    this.entries.push({ userId, exerciseId, level, codeHash, tokensIn, tokensOut, fallback });
  }
}

export function createSupabaseHintLog(db: RpcClient): HintLogPort {
  return {
    async record(e) {
      await callRpc(
        db,
        "hint_log_record",
        {
          p_user: e.userId,
          p_exercise: e.exerciseId,
          p_level: e.level,
          p_code_hash: e.codeHash,
          p_tokens_in: e.tokensIn,
          p_tokens_out: e.tokensOut,
          p_fallback: e.fallback,
        },
        z.string(),
      );
    },
  };
}

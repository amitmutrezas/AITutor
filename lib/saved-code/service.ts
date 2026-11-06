import { z } from "zod";
import { callRpc, type RpcClient } from "../db/rpc";

export interface SavedCode {
  exerciseId: string;
  code: string;
  updatedAt: string;
}

/** Latest code per user and exercise (A2, POLICY 2.1). */
export interface SavedCodePort {
  save(userId: string, exerciseId: string, code: string): Promise<void>;
  list(userId: string): Promise<SavedCode[]>;
  /** Returns whether a row existed. */
  deleteOne(userId: string, exerciseId: string): Promise<boolean>;
  /** Returns how many rows were removed. */
  deleteAll(userId: string): Promise<number>;
}

export class InMemorySavedCode implements SavedCodePort {
  private rows = new Map<string, Map<string, SavedCode>>();
  constructor(private now: () => Date = () => new Date()) {}

  private forUser(userId: string) {
    let m = this.rows.get(userId);
    if (!m) this.rows.set(userId, (m = new Map()));
    return m;
  }
  async save(userId: string, exerciseId: string, code: string) {
    this.forUser(userId).set(exerciseId, { exerciseId, code, updatedAt: this.now().toISOString() });
  }
  async list(userId: string) {
    return [...this.forUser(userId).values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }
  async deleteOne(userId: string, exerciseId: string) {
    return this.forUser(userId).delete(exerciseId);
  }
  async deleteAll(userId: string) {
    const n = this.forUser(userId).size;
    this.rows.delete(userId);
    return n;
  }
}

const listRow = z.object({ exercise_id: z.string(), code: z.string(), updated_at: z.string() });

export function createSupabaseSavedCode(db: RpcClient): SavedCodePort {
  return {
    async save(userId, exerciseId, code) {
      await callRpc(
        db,
        "saved_code_upsert",
        { p_user: userId, p_exercise: exerciseId, p_code: code },
        z.string(),
      );
    },
    async list(userId) {
      const rows = await callRpc(db, "saved_code_list", { p_user: userId }, z.array(listRow));
      return rows.map((r) => ({
        exerciseId: r.exercise_id,
        code: r.code,
        updatedAt: r.updated_at,
      }));
    },
    deleteOne: (userId, exerciseId) =>
      callRpc(db, "saved_code_delete", { p_user: userId, p_exercise: exerciseId }, z.boolean()),
    deleteAll: (userId) =>
      callRpc(db, "saved_code_delete_all", { p_user: userId }, z.number().int().nonnegative()),
  };
}

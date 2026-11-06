import { z } from "zod";
import { PLAN_KEYS, type PlanKey } from "../config";
import { callRpc, type RpcClient } from "../db/rpc";

export interface AccountInfo {
  email: string;
  /** The plan with an active subscription, otherwise "free". */
  planKey: PlanKey;
  /** Integer credits, counted in lib/credits (the model never sets this). */
  balance: number;
}

export interface AccountPort {
  get(userId: string): Promise<AccountInfo | null>;
  /**
   * Deletes the account. Saved code, hint log, credit rows, subscriptions and the profile go with
   * it (A3, POLICY 2.3): in Postgres this is `delete from auth.users`, which cascades.
   */
  delete(userId: string): Promise<void>;
}

export interface InMemoryAccountOptions {
  /** Called on delete to model the database cascade in tests. */
  onDelete?: (userId: string) => void | Promise<void>;
}

export class InMemoryAccounts implements AccountPort {
  readonly accounts = new Map<string, AccountInfo>();
  constructor(
    initial: Record<string, AccountInfo> = {},
    private opts: InMemoryAccountOptions = {},
  ) {
    for (const [id, a] of Object.entries(initial)) this.accounts.set(id, a);
  }
  async get(userId: string) {
    return this.accounts.get(userId) ?? null;
  }
  async delete(userId: string) {
    this.accounts.delete(userId);
    await this.opts.onDelete?.(userId);
  }
}

const accountRow = z
  .object({
    email: z.string(),
    plan_id: z.enum(PLAN_KEYS),
    balance: z.number().int().nonnegative(),
  })
  .nullable();

export function createSupabaseAccounts(db: RpcClient): AccountPort {
  return {
    async get(userId) {
      const r = await callRpc(db, "account_get", { p_user: userId }, accountRow);
      return r ? { email: r.email, planKey: r.plan_id, balance: r.balance } : null;
    },
    async delete(userId) {
      await callRpc(db, "account_delete", { p_user: userId }, z.unknown());
    },
  };
}

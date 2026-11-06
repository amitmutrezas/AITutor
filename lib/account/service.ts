import { z } from "zod";
import { PLAN_KEYS, type PlanKey } from "../config";
import { callRpc, type RpcClient } from "../db/rpc";
import type { InMemoryPaymentStore } from "../payments/store";

export interface AccountInfo {
  email: string;
  /** The plan with an active subscription, otherwise "free". */
  planKey: PlanKey;
  /** Integer credits, counted in lib/credits (the model never sets this). */
  balance: number;
}

export interface LiveSubscriptionRef {
  razorpaySubscriptionId: string | null;
  status: string;
}

export interface AccountPort {
  get(userId: string): Promise<AccountInfo | null>;
  /**
   * Step 1 of deletion, in the database: takes the profile lock and sets the deleting marker, after which
   * no checkout can start or attach for this account. Returns the live subscription to cancel at Razorpay,
   * or null if the account does not exist.
   */
  beginDeletion(userId: string): Promise<{ live: LiveSubscriptionRef | null } | null>;
  /** Clears the marker after a failed Razorpay cancel; the account stays and checkout works again. */
  cancelDeletion(userId: string): Promise<void>;
  /**
   * Step 3, only after beginDeletion and a successful cancel. Deletes the account. Saved code, hint log, credit rows, subscriptions and the profile go with
   * it (A3, POLICY 2.3): in Postgres this is `delete from auth.users`, which cascades.
   */
  delete(userId: string): Promise<void>;
}

export interface InMemoryAccountOptions {
  /** Called on delete to model the database cascade in tests. */
  onDelete?: (userId: string) => void | Promise<void>;
  /** Shares the deleting marker with the payment store fake, as profiles.deleting_at does in Postgres. */
  payments?: InMemoryPaymentStore;
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
  async beginDeletion(userId: string) {
    if (!this.accounts.has(userId)) return null;
    this.opts.payments?.deleting.add(userId);
    const live = (await this.opts.payments?.liveSubscription(userId)) ?? null;
    return {
      live: live && { razorpaySubscriptionId: live.razorpaySubscriptionId, status: live.status },
    };
  }
  async cancelDeletion(userId: string) {
    this.opts.payments?.deleting.delete(userId);
  }
  async delete(userId: string) {
    this.accounts.delete(userId);
    const pay = this.opts.payments;
    if (pay) {
      pay.deleting.delete(userId);
      // The cascade removes the user's subscription rows.
      pay.rows.splice(0, pay.rows.length, ...pay.rows.filter((r) => r.userId !== userId));
    }
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

const beginRow = z
  .object({
    live: z
      .object({ razorpay_subscription_id: z.string().nullable(), status: z.string() })
      .nullable()
      .transform((l) =>
        l ? { razorpaySubscriptionId: l.razorpay_subscription_id, status: l.status } : null,
      ),
  })
  .nullable();

export function createSupabaseAccounts(db: RpcClient): AccountPort {
  return {
    async get(userId) {
      const r = await callRpc(db, "account_get", { p_user: userId }, accountRow);
      return r ? { email: r.email, planKey: r.plan_id, balance: r.balance } : null;
    },
    async beginDeletion(userId) {
      const r = await callRpc(db, "account_begin_delete", { p_user: userId }, beginRow);
      return r ? { live: r.live } : null;
    },
    async cancelDeletion(userId) {
      await callRpc(db, "account_cancel_delete", { p_user: userId }, z.unknown());
    },
    async delete(userId) {
      await callRpc(db, "account_delete", { p_user: userId }, z.unknown());
    },
  };
}

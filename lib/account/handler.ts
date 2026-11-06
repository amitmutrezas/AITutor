import { z } from "zod";
import { failed, json, readBody } from "../api/http";
import { requireUser } from "../auth/session";
import type { Authenticate } from "../auth/types";
import { PLANS } from "../config";
import { cancelRazorpaySubscription } from "../payments/razorpay";
import type { PaymentStore } from "../payments/store";
import type { AccountPort } from "./service";

export const deleteAccountBody = z.strictObject({ confirm: z.literal("delete my account") });

export interface AccountDeps {
  authenticate: Authenticate;
  accounts: AccountPort;
  payments: PaymentStore | null;
  keyId?: string;
  keySecret?: string;
  fetchFn?: typeof fetch;
}

export function createAccountHandlers(deps: AccountDeps) {
  return {
    /** Plan and credits for the account page. */
    async GET(req: Request): Promise<Response> {
      const auth = await requireUser(req, deps.authenticate);
      if (!auth.ok) return auth.response;
      try {
        const account = await deps.accounts.get(auth.user.id);
        if (!account) return json(404, { error: "Not found" });
        const plan = PLANS[account.planKey];
        return json(200, {
          email: account.email,
          plan: { id: account.planKey, name: plan.name, monthlyCredits: plan.monthlyCredits },
          credits: account.balance,
        });
      } catch {
        return failed();
      }
    },

    /**
     * Deletes the account and everything stored for it (A3, POLICY 2.3). A live paid subscription
     * is cancelled at Razorpay first so a deleted learner is never billed; if that fails we stop.
     */
    async DELETE(req: Request): Promise<Response> {
      const auth = await requireUser(req, deps.authenticate);
      if (!auth.ok) return auth.response;
      const body = await readBody(req, deleteAccountBody);
      if (!body.ok) return body.response;
      const userId = auth.user.id;
      try {
        const live = deps.payments ? await deps.payments.liveSubscription(userId) : null;
        if (live?.razorpaySubscriptionId) {
          const cancelled = await cancelRazorpaySubscription(
            { keyId: deps.keyId, keySecret: deps.keySecret, fetchFn: deps.fetchFn },
            live.razorpaySubscriptionId,
          );
          // An unpaid (pending) checkout is harmless if Razorpay refuses to cancel it.
          if (!cancelled && live.status !== "pending") {
            return json(502, {
              error: "We could not cancel your subscription, so your account was not deleted",
            });
          }
        }
        await deps.accounts.delete(userId);
        return json(200, { deleted: true });
      } catch {
        return failed();
      }
    },
  };
}

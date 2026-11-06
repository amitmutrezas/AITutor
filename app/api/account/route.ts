import { unavailable } from "../../../lib/api/http";
import { createAccountHandlers } from "../../../lib/account/handler";
import { getServices } from "../../../lib/server/services";

export const dynamic = "force-dynamic";

function handlers() {
  const s = getServices();
  return s
    ? createAccountHandlers({
        authenticate: s.authenticate,
        accounts: s.accounts,
        payments: s.payments,
        keyId: process.env.RAZORPAY_KEY_ID,
        keySecret: process.env.RAZORPAY_KEY_SECRET,
      })
    : null;
}

export async function GET(req: Request) {
  return handlers()?.GET(req) ?? unavailable();
}
export async function DELETE(req: Request) {
  return handlers()?.DELETE(req) ?? unavailable();
}

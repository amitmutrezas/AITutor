import { unavailable } from "../../../../../lib/api/http";
import { handleMockConfirm } from "../../../../../lib/payments/mock";
import { getServices } from "../../../../../lib/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const s = getServices();
  if (!s) return unavailable();
  return handleMockConfirm(request, { authenticate: s.authenticate, store: s.payments });
}

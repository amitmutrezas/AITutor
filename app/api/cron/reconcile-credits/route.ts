import { handleReconcileCron } from "../../../../lib/credits/cron";
import { getServices } from "../../../../lib/server/services";

export const dynamic = "force-dynamic";

// Called by Vercel Cron (vercel.json) with `Authorization: Bearer $CRON_SECRET`. Not a user route:
// the secret is the authentication (secure-endpoint rule 1).
export async function GET(req: Request) {
  return handleReconcileCron(req, {
    secret: process.env.CRON_SECRET,
    credits: getServices()?.credits ?? null,
  });
}

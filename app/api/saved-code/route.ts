import { unavailable } from "../../../lib/api/http";
import { createSavedCodeHandlers } from "../../../lib/saved-code/handler";
import { getServices } from "../../../lib/server/services";

export const dynamic = "force-dynamic";

function handlers() {
  const s = getServices();
  return s
    ? createSavedCodeHandlers({ authenticate: s.authenticate, savedCode: s.savedCode })
    : null;
}

export async function GET(req: Request) {
  return handlers()?.GET(req) ?? unavailable();
}
export async function PUT(req: Request) {
  return handlers()?.PUT(req) ?? unavailable();
}
export async function DELETE(req: Request) {
  return handlers()?.DELETE(req) ?? unavailable();
}

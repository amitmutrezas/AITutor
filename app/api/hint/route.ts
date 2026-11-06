import { unavailable } from "../../../lib/api/http";
import { getHintHandler } from "../../../lib/server/services";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const handler = getHintHandler();
  if (!handler) return unavailable();
  return handler(req);
}

import { createHash, timingSafeEqual } from "node:crypto";
import { json } from "../api/http";
import type { CreditsPort } from "./types";

function safeEqual(a: string, b: string): boolean {
  // Hash first so the lengths are equal and the compare is constant-time.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Cron-only reconcile (POLICY 3.2): releases credit reservations nobody settled or released.
 * Requires `Authorization: Bearer <CRON_SECRET>`; fails closed (401) if the secret is not configured.
 * Idempotent, so an overlapping or repeated run is harmless.
 */
export async function handleReconcileCron(
  req: Request,
  deps: { secret: string | undefined; credits: CreditsPort | null },
): Promise<Response> {
  const header = req.headers.get("authorization") ?? "";
  if (!deps.secret || !safeEqual(header, `Bearer ${deps.secret}`)) {
    return json(401, { error: "Unauthorized" });
  }
  if (!deps.credits) return json(503, { error: "Service unavailable" });
  try {
    return json(200, { released: await deps.credits.reconcile() });
  } catch {
    return json(500, { error: "Something went wrong" });
  }
}

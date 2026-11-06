import { unauthorized } from "../api/http";
import type { AuthUser, Authenticate } from "./types";

/**
 * The one way an API route learns who is calling (secure-endpoint rule 1). Every route except
 * the Razorpay webhook (signature) and /api/health calls this first and returns the response if
 * the user is missing. There is no header-based fallback: identity comes only from the verified session.
 */
export async function requireUser(
  req: Request,
  authenticate: Authenticate,
): Promise<{ ok: true; user: AuthUser } | { ok: false; response: Response }> {
  let user: AuthUser | null;
  try {
    user = await authenticate(req);
  } catch {
    user = null;
  }
  if (!user || !user.id) return { ok: false, response: unauthorized() };
  return { ok: true, user };
}

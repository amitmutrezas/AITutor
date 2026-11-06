import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { safeNextPath } from "../../../../lib/auth/next-path";
import { createSupabaseServerAuth } from "../../../../lib/auth/supabase-provider";

export const dynamic = "force-dynamic";

// Starts Google sign-in. Supabase creates the account on first use and signs in after that, same as
// the email code. The return trip lands on /auth/confirm, which swaps the code for a session.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const fail = () => NextResponse.redirect(new URL("/signin?error=confirm", url));
  const supabase = createSupabaseServerAuth(await cookies());
  if (!supabase) return fail();
  const next = url.searchParams.has("next") ? safeNextPath(url.searchParams.get("next")) : null;
  const back = new URL("/auth/confirm", url);
  if (next) back.searchParams.set("next", next);
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: back.toString(), skipBrowserRedirect: true },
    });
    if (error || !data.url) return fail();
    return NextResponse.redirect(data.url);
  } catch {
    return fail();
  }
}

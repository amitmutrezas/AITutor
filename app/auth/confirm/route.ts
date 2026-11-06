import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerAuth } from "../../../lib/auth/supabase-provider";

export const dynamic = "force-dynamic";

// Target of the sign-up confirmation email link. The redirect target is fixed (no `next`
// parameter), so this cannot be used as an open redirect.
const query = z.object({
  code: z.string().min(1).max(2000).optional(),
  token_hash: z.string().min(1).max(2000).optional(),
  type: z.enum(["signup", "email"]).optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = query.safeParse(Object.fromEntries(url.searchParams.entries()));
  const fail = () => NextResponse.redirect(new URL("/signin?error=confirm", url));
  if (!parsed.success) return fail();

  const supabase = createSupabaseServerAuth(await cookies());
  if (!supabase) return fail();
  try {
    const { code, token_hash, type } = parsed.data;
    let error: unknown = new Error("missing parameters");
    if (code) ({ error } = await supabase.auth.exchangeCodeForSession(code));
    else if (token_hash && type) ({ error } = await supabase.auth.verifyOtp({ token_hash, type }));
    if (error) return fail();
  } catch {
    return fail();
  }
  return NextResponse.redirect(new URL("/account", url));
}

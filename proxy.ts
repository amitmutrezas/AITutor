import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Keeps the Supabase session fresh: validates the cookie and, if the access token expired, writes
 * the refreshed cookies onto both the forwarded request (so API routes see the new token) and the
 * response (so the browser stores it). No-op when Supabase env vars are not set.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  try {
    await supabase.auth.getUser();
  } catch {
    // An auth outage must not take pages down; routes verify the session themselves.
  }
  return response;
}

export const config = {
  // Skip static assets, the sandboxed worker script and the signature-authenticated webhook.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|runner/worker\\.js|api/razorpay/webhook|api/cron).*)",
  ],
};

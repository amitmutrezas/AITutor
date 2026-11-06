import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { Authenticate } from "./types";

type Env = Record<string, string | undefined>;

export function supabasePublicEnv(env: Env = process.env): { url: string; anonKey: string } | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

/**
 * Verifies the Supabase session cookie on the request with the Auth server (getUser validates the
 * JWT; getSession would only decode it). Token refresh happens in proxy.ts. Returns null when
 * Supabase is not configured, so routes fail closed.
 */
export function createSupabaseAuthenticate(env: Env = process.env): Authenticate {
  const cfg = supabasePublicEnv(env);
  return async (req) => {
    if (!cfg) return null;
    try {
      const supabase = createServerClient(cfg.url, cfg.anonKey, {
        cookies: {
          getAll: () =>
            parseCookieHeader(req.headers.get("cookie") ?? "").map((c) => ({
              name: c.name,
              value: c.value ?? "",
            })),
          setAll: () => undefined, // refresh is done in proxy.ts; routes only read
        },
      });
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) return null;
      return { id: data.user.id, email: data.user.email ?? "" };
    } catch {
      return null;
    }
  };
}

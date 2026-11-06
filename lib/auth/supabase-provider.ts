import { createServerClient } from "@supabase/ssr";
import type { AuthProvider } from "./credentials";
import { supabasePublicEnv } from "./supabase";

export interface CookieStore {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options?: Record<string, unknown>): void;
}

/** Supabase Auth client bound to the request's cookie store (Next.js `cookies()`), or null if unconfigured. */
export function createSupabaseServerAuth(
  store: CookieStore,
  env: Record<string, string | undefined> = process.env,
) {
  const cfg = supabasePublicEnv(env);
  if (!cfg) return null;
  return createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) store.set(name, value, options);
      },
    },
  });
}

/** The part of the Supabase client the provider uses (so tests can pass a fake). */
export type SupabaseAuthLike = Pick<
  NonNullable<ReturnType<typeof createSupabaseServerAuth>>["auth"],
  "signInWithOtp" | "verifyOtp" | "signOut"
>;

export function createSupabaseAuthProvider(
  store: CookieStore,
  client?: { auth: SupabaseAuthLike },
): AuthProvider | null {
  const supabase = client ?? createSupabaseServerAuth(store);
  if (!supabase) return null;
  return {
    async sendCode(email, confirmRedirectTo) {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        // A new email creates the account; an existing one just signs in.
        options: { shouldCreateUser: true, emailRedirectTo: confirmRedirectTo },
      });
      if (!error) return "sent";
      return error.status === 429 ? "rate_limited" : "error";
    },
    async verifyCode(email, token) {
      const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
      return !error && !!data.session;
    },
    async signOut() {
      // signOut resolves with { error } instead of throwing; a failure means the session may still be
      // valid, so surface it (the handler turns a throw into a 500).
      const { error } = await supabase.auth.signOut();
      if (error) throw new Error("sign-out failed");
    },
  };
}

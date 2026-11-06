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

export function createSupabaseAuthProvider(store: CookieStore): AuthProvider | null {
  const supabase = createSupabaseServerAuth(store);
  if (!supabase) return null;
  return {
    async signUp(email, password, confirmRedirectTo) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: confirmRedirectTo },
      });
      if (error) return "error";
      return data.session ? "signed_in" : "confirm_email";
    },
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return !error;
    },
    async signOut() {
      await supabase.auth.signOut();
    },
  };
}

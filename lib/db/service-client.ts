import { createClient } from "@supabase/supabase-js";
import type { RpcClient } from "./rpc";

type Env = Record<string, string | undefined>;

/**
 * Service-role client. SERVER ONLY: the key bypasses row level security. Returns null when the
 * env vars named in .env.example are missing so callers can fail closed with a generic 503.
 */
export function createServiceRpc(env: Env = process.env): RpcClient | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async rpc(fn, args) {
      const { data, error } = await client.rpc(fn, args);
      return { data, error: error ? { message: error.message } : null };
    },
  };
}

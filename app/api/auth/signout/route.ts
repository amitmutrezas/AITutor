import { cookies } from "next/headers";
import { unavailable } from "../../../../lib/api/http";
import { handleSignOut } from "../../../../lib/auth/credentials";
import { createSupabaseAuthProvider } from "../../../../lib/auth/supabase-provider";

export const dynamic = "force-dynamic";

// Takes no input; signing out when already signed out is harmless.
export async function POST() {
  const provider = createSupabaseAuthProvider(await cookies());
  if (!provider) return unavailable();
  return handleSignOut(provider);
}

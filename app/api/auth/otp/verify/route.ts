import { cookies } from "next/headers";
import { unavailable } from "../../../../../lib/api/http";
import { handleVerifyCode } from "../../../../../lib/auth/credentials";
import { createSupabaseAuthProvider } from "../../../../../lib/auth/supabase-provider";

export const dynamic = "force-dynamic";

// Unauthenticated by nature: this is where a session begins. Input is Zod-validated in handleVerifyCode.
export async function POST(req: Request) {
  const provider = createSupabaseAuthProvider(await cookies());
  if (!provider) return unavailable();
  return handleVerifyCode(req, provider);
}

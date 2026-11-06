import { z } from "zod";

/**
 * The only database surface the app code depends on: named Postgres functions
 * (supabase/migrations/0002). Adapters in lib/credits, lib/payments, lib/saved-code and
 * lib/account call these; unit tests use in-memory fakes of the domain ports instead (CLAUDE.md:
 * tests never call a database).
 */
export interface RpcClient {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

/** Generic by design: never carries SQL, arguments or learner code (secure-endpoint rule 6). */
export class RpcError extends Error {
  constructor(readonly fn: string) {
    super(`database call failed: ${fn}`);
    this.name = "RpcError";
  }
}

export async function callRpc<T>(
  client: RpcClient,
  fn: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new RpcError(fn);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new RpcError(fn);
  return parsed.data;
}

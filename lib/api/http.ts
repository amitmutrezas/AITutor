import { z } from "zod";

export const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

export const unauthorized = (): Response => json(401, { error: "Sign in required" });
export const invalid = (): Response => json(400, { error: "Invalid request" });
export const unavailable = (): Response => json(503, { error: "Service unavailable" });
export const failed = (): Response => json(500, { error: "Something went wrong" });

type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

/** Zod-validates a JSON body. Schemas should be strict so unknown fields are rejected. */
export async function readBody<T>(req: Request, schema: z.ZodType<T>): Promise<Parsed<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: invalid() };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, response: invalid() };
}

/** Zod-validates the query string (all values are strings). */
export function readQuery<T>(req: Request, schema: z.ZodType<T>): Parsed<T> {
  const raw = Object.fromEntries(new URL(req.url).searchParams.entries());
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, response: invalid() };
}

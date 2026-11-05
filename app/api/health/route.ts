import { z } from "zod";

// N1: every route validates its input with Zod. The health check takes no query parameters.
const HealthQuery = z.object({}).strict();

export function GET(request: Request) {
  const query = Object.fromEntries(new URL(request.url).searchParams);
  if (!HealthQuery.safeParse(query).success) {
    return Response.json({ ok: false }, { status: 400 });
  }
  return Response.json({ ok: true });
}

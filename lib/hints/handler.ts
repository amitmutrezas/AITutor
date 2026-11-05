import { z } from "zod";
import { HINTS } from "../config";
import { costForLevel } from "./ladder";
import { createAnthropicModel } from "./anthropic";
import { createInMemoryExerciseStore, type LoadExercise } from "./exercise-store";
import { requestHint, type RequestHintArgs } from "./service";
import type { HintModel } from "./types";

export const hintBodySchema = z
  .object({
    exerciseId: z.string().min(1).max(100),
    level: z.number().int().min(1).max(5),
    code: z.string().max(HINTS.maxCodeChars),
  })
  .strict();

/** TODO(M5): replace with the real credits module (lib/credits). Interface only; no deduction here. */
export interface CreditsPort {
  /** C2: must refuse before any model call when the balance would go below zero. */
  canAfford(userId: string, cost: number): Promise<boolean>;
  /** Called only when the result is chargeable (not a fallback, not a cache hit). */
  charge(userId: string, cost: number, ref: { exerciseId: string; level: number }): Promise<void>;
}

export const noopCredits: CreditsPort = {
  canAfford: async () => true,
  charge: async () => undefined,
};

/** TODO(M5): replace with the real session auth. Until then the user id is a header placeholder. */
export type Authenticate = (req: Request) => Promise<string | null>;
export const headerAuth: Authenticate = async (req) => req.headers.get("x-user-id")?.trim() || null;

export interface RateLimiter {
  allow(userId: string): boolean;
}

export function createRateLimiter(
  maxRequests: number = HINTS.rateLimit.maxRequests,
  windowMs: number = HINTS.rateLimit.windowMs,
  now: () => number = Date.now,
): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    allow(userId) {
      const t = now();
      const recent = (hits.get(userId) ?? []).filter((x) => t - x < windowMs);
      if (recent.length >= maxRequests) {
        hits.set(userId, recent);
        return false;
      }
      recent.push(t);
      hits.set(userId, recent);
      return true;
    },
  };
}

export interface HandlerDeps {
  loadExercise: LoadExercise;
  model: HintModel;
  authenticate: Authenticate;
  rateLimiter: RateLimiter;
  credits: CreditsPort;
  requestHintDeps?: Parameters<typeof requestHint>[1];
}

export function defaultDeps(): HandlerDeps {
  return {
    loadExercise: createInMemoryExerciseStore(),
    model: createAnthropicModel(),
    authenticate: headerAuth,
    rateLimiter: createRateLimiter(),
    credits: noopCredits,
  };
}

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
}

export function createHintHandler(deps: HandlerDeps = defaultDeps()) {
  return async function POST(req: Request): Promise<Response> {
    const userId = await deps.authenticate(req);
    if (!userId) return json(401, { error: "Unauthorized" });
    if (!deps.rateLimiter.allow(userId)) return json(429, { error: "Too many requests" });

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json(400, { error: "Invalid request" });
    }
    const parsed = hintBodySchema.safeParse(raw);
    if (!parsed.success) return json(400, { error: "Invalid request" });
    const { exerciseId, level: lv, code } = parsed.data;
    const level = lv as 1 | 2 | 3 | 4 | 5;
    const cost = costForLevel(level);

    try {
      // Levels 1-3 never load the solution for the prompt (H2). Levels 4-5 need it (H3).
      const exercise =
        level >= 4
          ? await deps.loadExercise(exerciseId, { withSolution: true })
          : await deps.loadExercise(exerciseId, { withSolution: false });
      if (!exercise) return json(404, { error: "Not found" });

      if (!(await deps.credits.canAfford(userId, cost))) return json(402, { error: "Insufficient credits" });

      const args = {
        level,
        exercise,
        learnerCode: code,
        model: deps.model,
        // Leak check (H4) needs the solution at every level; fetched lazily after the model answers.
        getReferenceForLeakCheck: async () =>
          (await deps.loadExercise(exerciseId, { withSolution: true }))?.referenceSolution ?? "",
      } as RequestHintArgs;
      const result = await requestHint(args, deps.requestHintDeps);

      if (result.charge && cost > 0) await deps.credits.charge(userId, cost, { exerciseId, level });

      return json(200, {
        hint: result.hint,
        level: result.level,
        fallback: result.fallback,
        charged: result.charge && cost > 0,
        cost: result.charge ? cost : 0,
        cached: result.cached,
        tokens: { in: result.tokensIn, out: result.tokensOut },
      });
    } catch {
      return json(500, { error: "Something went wrong" });
    }
  };
}

import { z } from "zod";
import { HINTS } from "../config";
import { costForLevel } from "./ladder";
import { createAnthropicModel } from "./anthropic";
import { createInMemoryExerciseStore, type LoadExercise } from "./exercise-store";
import { peekHint, requestHint, type RequestHintArgs } from "./service";
import type { HintModel } from "./types";

export const hintBodySchema = z
  .object({
    exerciseId: z.string().min(1).max(100),
    level: z.number().int().min(1).max(5),
    code: z.string().max(HINTS.maxCodeChars),
  })
  .strict();

/**
 * Atomic credit reservation (C2). TODO(M5): lib/credits implements this in a DB transaction
 * (reserve = conditional decrement that fails if the balance would go below zero; release = refund).
 */
export interface CreditsPort {
  /** Atomically takes `cost` credits. Returns false (and takes nothing) if the balance is too low. */
  reserve(userId: string, cost: number): Promise<boolean>;
  /** Gives back a reservation when the hint failed, fell back, or was a free cache hit. */
  release(userId: string, cost: number): Promise<void>;
}

export const noopCredits: CreditsPort = {
  reserve: async () => true,
  release: async () => undefined,
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

      // C2: refuse before any model call. Free levels reserve nothing.
      // H7: a cached or in-flight identical request is free, so it must not be refused for balance.
      const free =
        cost > 0 &&
        peekHint({ level, exerciseId, learnerCode: code }, deps.requestHintDeps) !== null;
      let reserved = cost > 0 && !free;
      if (reserved && !(await deps.credits.reserve(userId, cost))) {
        return json(402, { error: "Insufficient credits" });
      }
      let keep = false;
      try {
        const args = {
          level,
          exercise,
          learnerCode: code,
          userId,
          model: deps.model,
          // Leak check (H4) needs the solution at every level; fetched lazily after the model answers.
          getReferenceForLeakCheck: async () =>
            (await deps.loadExercise(exerciseId, { withSolution: true }))?.referenceSolution ?? "",
        } as RequestHintArgs;
        const result = await requestHint(args, deps.requestHintDeps);

        if (cost > 0 && !reserved && result.charge) {
          // The cached entry vanished between peek and request: settle the reservation now.
          if (!(await deps.credits.reserve(userId, cost))) {
            return json(402, { error: "Insufficient credits" });
          }
          reserved = true;
        }
        keep = result.charge;

        return json(200, {
          hint: result.hint,
          level: result.level,
          fallback: result.fallback,
          charged: keep && cost > 0,
          cost: result.charge ? cost : 0,
          cached: result.cached,
          tokens: { in: result.tokensIn, out: result.tokensOut },
        });
      } finally {
        if (reserved && !keep) await deps.credits.release(userId, cost);
      }
    } catch {
      return json(500, { error: "Something went wrong" });
    }
  };
}

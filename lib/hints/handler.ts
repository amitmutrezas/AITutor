import { z } from "zod";
import type { AccountPort } from "../account/service";
import { requireUser } from "../auth/session";
import type { Authenticate } from "../auth/types";
import { HINTS, PLANS } from "../config";
import type { CreditsPort } from "../credits";
import { costForLevel } from "./ladder";
import type { LoadExercise } from "./exercise-store";
import type { HintLogPort } from "./hint-log";
import { peekHint, requestHint, type RequestHintArgs } from "./service";
import type { HintModel } from "./types";

export const hintBodySchema = z
  .object({
    exerciseId: z.string().min(1).max(100),
    level: z.number().int().min(1).max(5),
    code: z.string().max(HINTS.maxCodeChars),
  })
  .strict();

export type { CreditsPort };

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
  /** Real session auth (lib/auth). The route returns 401 without a verified session. */
  authenticate: Authenticate;
  rateLimiter: RateLimiter;
  /** DB-backed in production (lib/credits); in-memory fake in tests. */
  credits: CreditsPort;
  /** Plan lookup for the free-tier level cap (C5). */
  accounts: AccountPort;
  /** Hint request log: hash only, never code (N3). */
  hintLog: HintLogPort;
  requestHintDeps?: Parameters<typeof requestHint>[1];
}

/** C3: a failed hint must not stay charged, so one retry; a second failure is logged for reconciliation. */
async function releaseWithRetry(credits: CreditsPort, userId: string, cost: number): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await credits.release(userId, cost);
      return;
    } catch {
      // retry once
    }
  }
  console.error(JSON.stringify({ event: "credit_release_failed", userId, cost }));
}

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
}

export function createHintHandler(deps: HandlerDeps) {
  return async function POST(req: Request): Promise<Response> {
    const auth = await requireUser(req, deps.authenticate);
    if (!auth.ok) return auth.response;
    const userId = auth.user.id;
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
      // C5: a free account can use levels 1-2 only. Looked up only for levels above that cap.
      if (level > PLANS.free.maxLevel) {
        const account = await deps.accounts.get(userId);
        if (!account || level > PLANS[account.planKey].maxLevel) {
          return json(403, { error: "Upgrade your plan to use this level" });
        }
      }

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

        // N3: the log row carries the code hash, never the code. A logging failure must not
        // fail or un-charge a hint the learner already received.
        try {
          await deps.hintLog.record({
            userId,
            exerciseId,
            level,
            codeHash: result.codeHash,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
            fallback: result.fallback,
          });
        } catch {
          console.error(JSON.stringify({ event: "hint_log_failed", userId, exerciseId, level }));
        }

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
        if (reserved && !keep) await releaseWithRetry(deps.credits, userId, cost);
      }
    } catch {
      return json(500, { error: "Something went wrong" });
    }
  };
}

import { createHash } from "node:crypto";
import { HINTS } from "../config";
import { leakCheck } from "./leak";
import { getLevel, modelForLevel } from "./ladder";
import { buildHintPrompt } from "./prompt";
import type {
  ExerciseForHint,
  ExerciseWithSolution,
  HintLevel,
  HintModel,
  HintPromptInput,
} from "./types";

export interface HintResult {
  hint: string;
  level: HintLevel;
  /** True when the stored prepared hint was returned (leak, error or timeout). */
  fallback: boolean;
  /** Why the fallback was used, if it was. */
  fallbackReason?: "leak" | "model-error" | "timeout" | "prompt-error" | "too-long";
  /** H5: false for fallbacks and cache hits. Billing (M5) must only charge when true. */
  charge: boolean;
  cached: boolean;
  /** N2: token counts for cost logging. Zero for fallbacks/cache hits. */
  tokensIn: number;
  tokensOut: number;
  /** N3: sha256 of the learner code. The code itself is never returned or logged. */
  codeHash: string;
}

export interface HintLogEvent {
  event: "hint";
  /** Opaque user id (never an email), so cost per learner can be computed (N2). */
  userId?: string;
  exerciseId: string;
  level: HintLevel;
  codeHash: string;
  fallback: boolean;
  fallbackReason?: string;
  cached: boolean;
  tokensIn: number;
  tokensOut: number;
}

export interface HintCache {
  get(key: string): HintResult | undefined;
  set(key: string, value: HintResult): void;
}

/** H7: tiny in-memory TTL cache. */
export class TtlCache implements HintCache {
  private store = new Map<string, { value: HintResult; expires: number }>();
  constructor(
    private ttlMs: number = HINTS.cacheTtlMs,
    private now: () => number = Date.now,
    private maxEntries: number = HINTS.cacheMaxEntries,
  ) {}
  get size(): number {
    return this.store.size;
  }
  get(key: string): HintResult | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: HintResult): void {
    const t = this.now();
    // Opportunistic sweep of expired entries, then evict oldest beyond the cap.
    for (const [k, v] of this.store) if (v.expires <= t) this.store.delete(k);
    this.store.delete(key);
    this.store.set(key, { value, expires: t + this.ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}

const defaultCache = new TtlCache();

export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function cacheKey(exerciseId: string, level: HintLevel, codeHash: string): string {
  return `${exerciseId}:${level}:${codeHash}`;
}

export interface RequestHintDeps {
  cache?: HintCache;
  timeoutMs?: number;
  /** Receives metadata only (hash, ids, tokens). Defaults to console.info as JSON. */
  log?: (e: HintLogEvent) => void;
  /** Model name override; defaults to the level's configured model (N2). */
  modelName?: string;
}

/** Shown when even the stored fallback cannot be verified safe (POLICY 1.2). */
export const SAFE_GENERIC_HINT =
  "A prepared hint isn't available right now; try again or use the next level";

export type RequestHintArgs = {
  /** Opaque user id for N2 logging. */
  userId?: string;
  learnerCode: string;
  model: HintModel;
  /**
   * Resolves the reference solution for the leak check. Called lazily, only AFTER the model
   * has answered, and never used to build the prompt at levels 1-3. For level 4 the
   * exercise already carries it.
   */
  getReferenceForLeakCheck?: () => Promise<string>;
} & (
  | { level: 1 | 2 | 3; exercise: ExerciseForHint & { referenceSolution?: never } }
  | { level: 4 | 5; exercise: ExerciseWithSolution }
);

class TimeoutError extends Error {}

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new TimeoutError("model timeout"));
    }, ms);
  });
  return Promise.race([run(ctrl.signal), timeout]).finally(() => clearTimeout(timer));
}

function defaultLog(e: HintLogEvent): void {
  console.info(JSON.stringify(e));
}

const inflightByCache = new WeakMap<HintCache, Map<string, Promise<HintResult>>>();

/** H7: is there a cached or in-flight result for this request? Used to skip credit reservation. */
export function peekHint(
  args: { level: HintLevel; exerciseId: string; learnerCode: string },
  deps: RequestHintDeps = {},
): "cached" | "inflight" | null {
  const cache = deps.cache ?? defaultCache;
  const key = cacheKey(args.exerciseId, args.level, hashCode(args.learnerCode));
  if (cache.get(key)) return "cached";
  if (inflightByCache.get(cache)?.has(key)) return "inflight";
  return null;
}

export async function requestHint(
  args: RequestHintArgs,
  deps: RequestHintDeps = {},
): Promise<HintResult> {
  const { level, exercise, learnerCode } = args;
  const cache = deps.cache ?? defaultCache;
  let inflight = inflightByCache.get(cache);
  if (!inflight) inflightByCache.set(cache, (inflight = new Map()));
  const key = cacheKey(exercise.id, level, hashCode(learnerCode));

  const cached = cache.get(key);
  const pending = inflight.get(key);
  if (cached || pending) {
    // H7: a cache hit or a concurrent identical request is never charged again.
    const base = cached ?? (await pending!);
    const r: HintResult = { ...base, cached: true, charge: false, tokensIn: 0, tokensOut: 0 };
    (deps.log ?? defaultLog)(logEvent(r, exercise.id, level, args.userId));
    return r;
  }
  const run = generate(args, deps, cache);
  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}

function logEvent(
  r: HintResult,
  exerciseId: string,
  level: HintLevel,
  userId?: string,
): HintLogEvent {
  return {
    event: "hint",
    userId,
    exerciseId,
    level,
    codeHash: r.codeHash,
    fallback: r.fallback,
    fallbackReason: r.fallbackReason,
    cached: r.cached,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
  };
}

async function generate(
  args: RequestHintArgs,
  deps: RequestHintDeps,
  cache: HintCache,
): Promise<HintResult> {
  const { level, exercise, learnerCode, model } = args;
  const log = deps.log ?? defaultLog;
  const codeHash = hashCode(learnerCode);
  const key = cacheKey(exercise.id, level, codeHash);

  const emit = (r: HintResult): HintResult => {
    log(logEvent(r, exercise.id, level, args.userId));
    return r;
  };

  // POLICY 1.2: a stored fallback must itself pass the leak check (Reveal exempt, H6).
  const safeFallbackText = async (): Promise<string> => {
    const stored = exercise.fallbackHints[level - 1];
    if (level === 5) return stored;
    try {
      const reference =
        level === 4 ? args.exercise.referenceSolution : await args.getReferenceForLeakCheck?.();
      if (!reference || typeof stored !== "string" || leakCheck(stored, reference).leaked) {
        return SAFE_GENERIC_HINT;
      }
      return stored;
    } catch {
      return SAFE_GENERIC_HINT;
    }
  };

  // N2: tokens already spent on a model call that succeeded are kept on the fallback.
  const fallback = async (
    reason: NonNullable<HintResult["fallbackReason"]>,
    tokensIn = 0,
    tokensOut = 0,
  ): Promise<HintResult> =>
    emit({
      hint: await safeFallbackText(),
      level,
      fallback: true,
      fallbackReason: reason,
      charge: false,
      cached: false,
      tokensIn,
      tokensOut,
      codeHash,
    });

  let text: string;
  let tokensIn: number;
  let tokensOut: number;
  try {
    const input = { level, exercise, learnerCode } as HintPromptInput;
    const prompt = buildHintPrompt(input);
    const res = await withTimeout(
      (signal) =>
        model.complete(prompt, {
          model: deps.modelName ?? modelForLevel(level),
          maxTokens: HINTS.maxOutputTokens,
          signal,
        }),
      deps.timeoutMs ?? HINTS.modelTimeoutMs,
    );
    text = res.text;
    tokensIn = res.tokensIn;
    tokensOut = res.tokensOut;
  } catch (err) {
    return await fallback(err instanceof TimeoutError ? "timeout" : "model-error");
  }

  // N2: the provider answered, so its usage is kept even if the output is unusable.
  if (typeof text !== "string" || text.trim() === "") {
    return await fallback("model-error", tokensIn, tokensOut);
  }
  // H1: enforce the per-level word cap (Reveal exempt) before leak check, cache or charge.
  const cap = getLevel(level).wordCap;
  if (cap !== null && text.trim().split(/\s+/).length > cap) {
    return await fallback("too-long", tokensIn, tokensOut);
  }

  // H6: Reveal skips the leak check; levels 1-4 always run it (fail closed).
  if (level !== 5) {
    try {
      const reference =
        level === 4 ? args.exercise.referenceSolution : await args.getReferenceForLeakCheck?.();
      if (!reference) return await fallback("leak", tokensIn, tokensOut);
      if (leakCheck(text, reference).leaked) return await fallback("leak", tokensIn, tokensOut);
    } catch {
      return await fallback("leak", tokensIn, tokensOut);
    }
  }

  const result: HintResult = {
    hint: text,
    level,
    fallback: false,
    charge: true,
    cached: false,
    tokensIn,
    tokensOut,
    codeHash,
  };
  cache.set(key, result);
  return emit(result);
}

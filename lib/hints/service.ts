import { createHash } from "node:crypto";
import { HINTS } from "../config";
import { leakCheck } from "./leak";
import { modelForLevel } from "./ladder";
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
  fallbackReason?: "leak" | "model-error" | "timeout" | "prompt-error";
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
  ) {}
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
    this.store.set(key, { value, expires: this.now() + this.ttlMs });
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

export type RequestHintArgs = {
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

export async function requestHint(args: RequestHintArgs, deps: RequestHintDeps = {}): Promise<HintResult> {
  const { level, exercise, learnerCode, model } = args;
  const cache = deps.cache ?? defaultCache;
  const log = deps.log ?? defaultLog;
  const codeHash = hashCode(learnerCode);
  const key = cacheKey(exercise.id, level, codeHash);

  const emit = (r: HintResult): HintResult => {
    log({
      event: "hint",
      exerciseId: exercise.id,
      level,
      codeHash,
      fallback: r.fallback,
      fallbackReason: r.fallbackReason,
      cached: r.cached,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
    });
    return r;
  };

  const cached = cache.get(key);
  if (cached) return emit({ ...cached, cached: true, charge: false, tokensIn: 0, tokensOut: 0 });

  const fallback = (reason: NonNullable<HintResult["fallbackReason"]>): HintResult =>
    emit({
      hint: exercise.fallbackHints[level - 1],
      level,
      fallback: true,
      fallbackReason: reason,
      charge: false,
      cached: false,
      tokensIn: 0,
      tokensOut: 0,
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
    if (typeof text !== "string" || text.trim() === "") throw new Error("empty model output");
  } catch (err) {
    return fallback(err instanceof TimeoutError ? "timeout" : "model-error");
  }

  // H6: Reveal skips the leak check; levels 1-4 always run it (fail closed).
  if (level !== 5) {
    try {
      const reference =
        level === 4 ? args.exercise.referenceSolution : await args.getReferenceForLeakCheck?.();
      if (!reference) return fallback("leak");
      if (leakCheck(text, reference).leaked) return fallback("leak");
    } catch {
      return fallback("leak");
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

// Central config: thresholds, credit costs, model names. No secrets here (N1).

export const HINT_LEVELS = ["Nudge", "Concept", "Locate", "Scaffold", "Reveal"] as const;
export type HintLevelName = (typeof HINT_LEVELS)[number];

/** Integer credit cost per hint level, index 0 = Nudge ... index 4 = Reveal. */
export const CREDIT_COST_BY_LEVEL = [0, 0, 1, 2, 3] as const;

/** Model names come from env (see .env.example); the defaults are safe placeholders. */
export const MODELS = {
  low: process.env.HINT_MODEL_LOW || "claude-haiku-5-5",
  high: process.env.HINT_MODEL_HIGH || "claude-sonnet-5-5",
} as const;

/** PLACEHOLDER thresholds for the leak check; tuned in M2. */
export const LEAK_CHECK = {
  /** PLACEHOLDER: max token overlap ratio with the reference solution before a hint is blocked. */
  maxOverlapRatio: 0.5,
  /** PLACEHOLDER: min consecutive identical lines treated as a leak. */
  maxSharedLines: 2,
  /** Token n-gram size for the similarity measure. */
  ngramSize: 4,
  /** Solution lines with fewer normalized tokens than this are ignored by the contiguous-lines check. */
  minLineTokens: 3,
} as const;

/** Hint service limits (H5 timeout, H7 cache TTL, rate limit, input caps). */
export const HINTS = {
  /** Word cap for levels 1-4 (Reveal exempt). */
  wordCap: 120,
  modelTimeoutMs: 15_000,
  cacheTtlMs: 60_000,
  cacheMaxEntries: 500,
  maxOutputTokens: 700,
  maxCodeChars: 20_000,
  rateLimit: { maxRequests: 20, windowMs: 60_000 },
} as const;

/** Plan keys. "free" has no subscription; basic and advanced are Razorpay plans (P1). */
export const PLAN_KEYS = ["free", "basic", "advanced"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

/**
 * Single source of truth for plans (POLICY 3.5, C1). Prices and credit amounts are PLACEHOLDERS:
 * they are not decided (PLAN.md decision 1). `maxLevel` is the highest hint level a plan may
 * request (C5: a free account is limited to levels 1-2).
 */
export const PLANS = {
  free: {
    name: "Free",
    monthlyCredits: 0,
    maxLevel: 2,
    pricePaise: null,
    totalCount: 0,
    razorpayPlanEnv: null,
  },
  basic: {
    name: "Basic",
    monthlyCredits: 30, // PLACEHOLDER
    maxLevel: 5,
    pricePaise: null, // PLACEHOLDER: null = not decided yet
    totalCount: 120, // PLACEHOLDER: billing cycles for a new subscription
    razorpayPlanEnv: "RAZORPAY_PLAN_ID_BASIC",
  },
  advanced: {
    name: "Advanced",
    monthlyCredits: 100, // PLACEHOLDER
    maxLevel: 5,
    pricePaise: null, // PLACEHOLDER
    totalCount: 120, // PLACEHOLDER
    razorpayPlanEnv: "RAZORPAY_PLAN_ID_ADVANCED",
  },
} as const satisfies Record<
  PlanKey,
  {
    name: string;
    monthlyCredits: number;
    maxLevel: number;
    pricePaise: number | null;
    totalCount: number;
    razorpayPlanEnv: string | null;
  }
>;

/** Saved code (A2) and account limits. */
export const SAVED_CODE = {
  maxChars: 20_000,
  maxExerciseIdChars: 100,
} as const;

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
} as const;

/** PLACEHOLDER plans: prices and credits are not decided (PLAN.md decision 1). */
export const PLANS = {
  free: { name: "Free (placeholder)", monthlyCredits: 0, maxLevel: 2 },
  starter: { name: "Starter (placeholder)", monthlyCredits: 30, maxLevel: 4 },
  pro: { name: "Pro (placeholder)", monthlyCredits: 100, maxLevel: 4 },
} as const;

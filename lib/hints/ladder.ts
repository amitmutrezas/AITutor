import { CREDIT_COST_BY_LEVEL, HINT_LEVELS, HINTS, MODELS, type HintLevelName } from "../config";
import type { HintLevel } from "./types";

export interface LadderLevel {
  level: HintLevel;
  name: HintLevelName;
  /** Integer credits, from lib/config (C2). */
  cost: number;
  /** Word cap, or null for Reveal. */
  wordCap: number | null;
  instruction: string;
  mayContain: string;
  mustNotContain: string;
}

const TEXT: Record<HintLevel, Pick<LadderLevel, "instruction" | "mayContain" | "mustNotContain">> = {
  1: {
    instruction:
      "Give a Nudge: one question or observation that points the learner at where to look. Do not explain the fix.",
    mayContain: "one question or observation in plain language",
    mustNotContain: "any code, code fences, or the name of the fix",
  },
  2: {
    instruction:
      "Name the concept or idea the learner needs for this task and explain it briefly in general terms.",
    mayContain: "a named concept with a short general explanation",
    mustNotContain: "code taken from or equivalent to the solution",
  },
  3: {
    instruction:
      "Point to the line or block in the learner's code that is wrong and explain why it is wrong.",
    mayContain: "a reference to the learner's own line or block and the reason it fails",
    mustNotContain: "replacement code or a corrected version of the line",
  },
  4: {
    instruction:
      "Give a partial structure with gaps (use ___ or comments) for the learner to fill in. Never complete the solution.",
    mayContain: "a skeleton with explicit blanks and short guidance for each blank",
    mustNotContain: "the full working solution or any fully filled-in solution lines in sequence",
  },
  5: {
    instruction:
      "Show the complete solution and explain step by step why it works so the learner understands it.",
    mayContain: "the full solution with an explanation",
    mustNotContain: "nothing is forbidden at this level",
  },
};

export const LADDER: readonly LadderLevel[] = ([1, 2, 3, 4, 5] as const).map((level) => ({
  level,
  name: HINT_LEVELS[level - 1],
  cost: CREDIT_COST_BY_LEVEL[level - 1],
  wordCap: level === 5 ? null : HINTS.wordCap,
  ...TEXT[level],
}));

export function getLevel(level: HintLevel): LadderLevel {
  return LADDER[level - 1];
}

/** C2: cost per level from config. */
export function costForLevel(level: HintLevel): number {
  return CREDIT_COST_BY_LEVEL[level - 1];
}

/** N2: cheaper model for levels 1-3, stronger for 4-5. Names come from env via config. */
export function modelForLevel(level: HintLevel): string {
  return level <= 3 ? MODELS.low : MODELS.high;
}

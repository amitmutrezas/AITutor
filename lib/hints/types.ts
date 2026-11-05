// Hint-core types. NOTE: M1 defines lib/exercises/schema.ts in parallel; these minimal
// types are reconciled with M1's at integration. Do not import from M1 here.

export type HintLevel = 1 | 2 | 3 | 4 | 5;

/** Exercise data safe for levels 1-3: deliberately has NO referenceSolution field. */
export interface ExerciseForHint {
  id: string;
  title: string;
  statement: string;
  starterCode: string;
  tests: string;
  /** Stored fallback hints, index 0 = level 1 ... index 4 = level 5. */
  fallbackHints: [string, string, string, string, string];
}

/** Used only for levels 4-5 (prompt) and the leak check. */
export type ExerciseWithSolution = ExerciseForHint & { referenceSolution: string };

/**
 * Discriminated union: levels 1-3 cannot be given a solution (`referenceSolution?: never`),
 * levels 4-5 require one (H2, H3).
 */
export type HintPromptInput =
  | {
      level: 1 | 2 | 3;
      exercise: ExerciseForHint & { referenceSolution?: never };
      learnerCode: string;
    }
  | { level: 4 | 5; exercise: ExerciseWithSolution; learnerCode: string };

export interface BuiltPrompt {
  system: string;
  user: string;
}

export interface ModelResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export interface ModelCallOptions {
  model: string;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface HintModel {
  complete(prompt: BuiltPrompt, opts: ModelCallOptions): Promise<ModelResult>;
}

export interface LeakResult {
  leaked: boolean;
  reason: string;
  score: number;
}

export function isHintLevel(n: unknown): n is HintLevel {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5;
}

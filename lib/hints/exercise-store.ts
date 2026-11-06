import type { ExerciseForHint, ExerciseWithSolution } from "./types";

/**
 * Exercise access for the hint route. Implementations must select columns explicitly and
 * must not read referenceSolution unless `withSolution` is true (CLAUDE.md, H2).
 * The in-memory store below is a test fake; production uses lib/exercises/content.ts.
 */
export interface LoadExercise {
  (id: string, opts: { withSolution: false }): Promise<ExerciseForHint | null>;
  (id: string, opts: { withSolution: true }): Promise<ExerciseWithSolution | null>;
}

const SAMPLE: ExerciseWithSolution = {
  id: "sample-word-frequencies",
  title: "Word frequencies",
  statement:
    "Write wordFrequencies(text) that returns the three most common lowercase words as [word, count] pairs, highest count first, ties broken alphabetically.",
  starterCode: "function wordFrequencies(text) {\n  // your code here\n}\n",
  tests: 'expect(wordFrequencies("b a b")).toEqual([["b", 2], ["a", 1]]);',
  fallbackHints: [
    "What does the input look like once you split it into words?",
    "Think about how an object can keep a running count per key.",
    "Look at where you decide the order of the results: does it handle ties?",
    "Outline: split into words, count each, turn counts into pairs, sort, take three. Which step is missing?",
    "Count words in an object, sort the entries by count then word, and slice the first three.",
  ],
  referenceSolution:
    "function wordFrequencies(text) {\n  const counts = {};\n  for (const word of text.toLowerCase().split(/\\s+/).filter(Boolean)) {\n    counts[word] = (counts[word] || 0) + 1;\n  }\n  const entries = Object.entries(counts);\n  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));\n  return entries.slice(0, 3);\n}\n",
};

export function createInMemoryExerciseStore(exercises: ExerciseWithSolution[] = [SAMPLE]): LoadExercise {
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const load = async (id: string, opts: { withSolution: boolean }) => {
    const e = byId.get(id);
    if (!e) return null;
    if (opts.withSolution) return e;
    // Explicit field list: referenceSolution is never copied (H2).
    const { title, statement, starterCode, tests, fallbackHints } = e;
    return { id: e.id, title, statement, starterCode, tests, fallbackHints };
  };
  return load as LoadExercise;
}

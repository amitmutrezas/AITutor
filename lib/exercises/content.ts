// Server-side loader for content/exercises/*.json (E1, E2). Only `live` exercises are served.
// The learner-facing shape is parsed with a schema that has NO referenceSolution key, so a
// solution cannot reach the exercise list, the workspace or the hint prompt for levels 1-3 (H2).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LoadExercise } from "../hints/exercise-store";
import { exerciseSchema, type Exercise, type ExerciseForHint } from "./schema";

const DIR = join(process.cwd(), "content", "exercises");

const forHintSchema = exerciseSchema.omit({ referenceSolution: true });

function files(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

function readJson(dir: string, file: string): unknown {
  return JSON.parse(readFileSync(join(dir, file), "utf8"));
}

/** Live exercises without the reference solution, in file-name order. */
export function listLiveExercises(dir: string = DIR): ExerciseForHint[] {
  const out: ExerciseForHint[] = [];
  for (const file of files(dir)) {
    // Parsing with forHintSchema drops referenceSolution; unknown keys are stripped.
    const parsed = forHintSchema.safeParse(readJson(dir, file));
    if (parsed.success && parsed.data.status === "live") out.push(parsed.data);
  }
  return out;
}

export function findLiveExercise(id: string, dir: string = DIR): ExerciseForHint | undefined {
  return listLiveExercises(dir).find((e) => e.id === id);
}

/** Levels 4-5 and the leak check only (H3, H4). Reads the full record on demand. */
function findLiveWithSolution(id: string, dir: string): Exercise | undefined {
  for (const file of files(dir)) {
    const parsed = exerciseSchema.safeParse(readJson(dir, file));
    if (parsed.success && parsed.data.id === id && parsed.data.status === "live") {
      return parsed.data;
    }
  }
  return undefined;
}

/** Hint-route loader backed by the content files. Solution only when `withSolution` is true. */
export function createContentExerciseStore(dir: string = DIR): LoadExercise {
  const load = async (id: string, opts: { withSolution: boolean }) => {
    if (opts.withSolution) return findLiveWithSolution(id, dir) ?? null;
    return findLiveExercise(id, dir) ?? null;
  };
  return load as LoadExercise;
}

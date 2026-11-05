// Runs with `node --experimental-strip-types` (Node >= 22.6, on by default from 22.18), so no tsx dependency is needed.
// Usage: pnpm exercises:verify [--write]   (--write saves the computed status back to the JSON files)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exerciseSchema } from "../lib/exercises/schema.ts";
import { nextStatus, verifyExercise } from "../lib/exercises/verify.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "content", "exercises");
const write = process.argv.includes("--write");
let failed = false;

for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const path = join(dir, file);
  const parsed = exerciseSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    failed = true;
    console.error(`FAIL ${file}: schema: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    continue;
  }
  const exercise = parsed.data;
  const report = verifyExercise(exercise);
  const status = nextStatus(exercise.status, report.ok);
  console.log(`${report.ok ? "PASS" : "FAIL"} ${file}: ${exercise.status} -> ${status}`);
  for (const p of report.problems) console.log(`  - ${p}`);
  if (!report.ok && exercise.status === "live") failed = true; // E2: CI fails if a live exercise does not verify
  if (write && status !== exercise.status) writeFileSync(path, JSON.stringify({ ...exercise, status }, null, 2) + "\n");
}

process.exit(failed ? 1 : 0);

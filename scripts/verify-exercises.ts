// Runs with `node --experimental-strip-types` (Node >= 22.6, on by default from 22.18), so no tsx dependency is needed.
// Usage: pnpm exercises:verify          persists computed status (draft <-> verified) to the JSON files
//        pnpm exercises:verify --check  report only; exit non-zero on any status mismatch (for CI)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exerciseSchema } from "../lib/exercises/schema.ts";
import { isVerifyFailure, nextStatus, verifyExercise } from "../lib/exercises/verify.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "content", "exercises");
const check = process.argv.includes("--check");
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
  if (isVerifyFailure(exercise.status, report.ok)) failed = true; // E2: CI fails if a live or verified exercise does not verify
  if (status !== exercise.status) {
    if (check) failed = true; // stored status does not match the computed one
    else writeFileSync(path, JSON.stringify({ ...exercise, status }, null, 2) + "\n");
  }
}

process.exit(failed ? 1 : 0);

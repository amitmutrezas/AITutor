// Product eval for the leak check (H4). Run with `pnpm evals:product`.
// Fails if recall on known-leaky hints < 95% or good hints are rejected > 10% of the time.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { leakCheck } from "../../lib/hints/leak";

const MIN_RECALL = 0.95;
const MAX_GOOD_REJECT = 0.1;
const root = join(__dirname, "fixtures");

interface Item {
  kind: string;
  hint: string;
}
const read = <T>(dir: string, f: string): T => JSON.parse(readFileSync(join(root, dir, f), "utf8")) as T;

describe("product eval: leak check", () => {
  it("H4: leak recall >= 95% and good-hint rejection <= 10%", () => {
    let leaky = 0;
    let caught = 0;
    let good = 0;
    let rejected = 0;
    const misses: string[] = [];
    for (const dir of readdirSync(root)) {
      const { referenceSolution } = read<{ referenceSolution: string }>(dir, "exercise.json");
      for (const item of read<Item[]>(dir, "leaky.json")) {
        leaky++;
        if (leakCheck(item.hint, referenceSolution).leaked) caught++;
        else misses.push(`${dir}/leaky:${item.kind}`);
      }
      for (const item of read<Item[]>(dir, "good.json")) {
        good++;
        if (leakCheck(item.hint, referenceSolution).leaked) {
          rejected++;
          misses.push(`${dir}/good-rejected:${item.kind}`);
        }
      }
    }
    const recall = caught / leaky;
    const rejectRate = rejected / good;
    console.log(
      `leak recall: ${(recall * 100).toFixed(1)}% (${caught}/${leaky}); good rejected: ${(rejectRate * 100).toFixed(1)}% (${rejected}/${good})`,
    );
    if (misses.length) console.log(`misses: ${misses.join(", ")}`);
    expect(leaky).toBeGreaterThanOrEqual(8);
    expect(good).toBeGreaterThanOrEqual(8);
    expect(recall).toBeGreaterThanOrEqual(MIN_RECALL);
    expect(rejectRate).toBeLessThanOrEqual(MAX_GOOD_REJECT);
  });
});

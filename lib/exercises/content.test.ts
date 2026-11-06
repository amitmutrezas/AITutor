import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createContentExerciseStore, listLiveExercises } from "./content.ts";

const dir = join(process.cwd(), "content", "exercises");
const liveIds = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as { id: string; status: string })
  .filter((e) => e.status === "live")
  .map((e) => e.id)
  .sort();

describe("E2: the app serves every live exercise", () => {
  it("E2: the exercise list is exactly the live files", () => {
    expect(liveIds.length).toBeGreaterThanOrEqual(9);
    expect(
      listLiveExercises()
        .map((e) => e.id)
        .sort(),
    ).toEqual(liveIds);
  });

  it("H2: list and level 1-3 loads carry no referenceSolution, even by accident", () => {
    const solutions = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => (JSON.parse(readFileSync(join(dir, f), "utf8")) as { referenceSolution: string }).referenceSolution);
    const list = listLiveExercises();
    expect(JSON.stringify(list)).not.toContain("referenceSolution");
    // What the pages hand to the browser: statement, starter code and tests only. (The level 4-5
    // fallback hints legitimately show the solution, and never leave the server before level 4.)
    const shown = JSON.stringify(list.map((e) => [e.title, e.statement, e.starterCode, e.tests]));
    for (const s of solutions) expect(shown).not.toContain(JSON.stringify(s).slice(1, -1));
  });
});

describe("H1/H2: /api/hint can find every live exercise", () => {
  const load = createContentExerciseStore();

  it.each(liveIds)("H1: %s loads for levels 1-3 without a solution", async (id) => {
    const e = await load(id, { withSolution: false });
    expect(e?.id).toBe(id);
    expect(e && "referenceSolution" in e).toBe(false);
  });

  it.each(liveIds)("H3: %s loads with its solution for levels 4-5 and the leak check", async (id) => {
    const e = await load(id, { withSolution: true });
    expect(e?.referenceSolution.length).toBeGreaterThan(0);
  });

  it("H1: an unknown id is not found", async () => {
    expect(await load("sum-array", { withSolution: false })).toBeNull();
    expect(await load("../../package", { withSolution: true })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { CREDIT_COST_BY_LEVEL, HINT_LEVELS, PLANS } from "./index";

describe("config", () => {
  it("C2: credit costs per level are integers 0,0,1,2,3", () => {
    expect([...CREDIT_COST_BY_LEVEL]).toEqual([0, 0, 1, 2, 3]);
    expect(CREDIT_COST_BY_LEVEL.every(Number.isInteger)).toBe(true);
  });

  it("H1: there are five named hint levels, one cost each", () => {
    expect([...HINT_LEVELS]).toEqual(["Nudge", "Concept", "Locate", "Scaffold", "Reveal"]);
    expect(HINT_LEVELS.length).toBe(CREDIT_COST_BY_LEVEL.length);
  });

  it("C5: only the free plan is capped at levels 1-2; paid plans reach Reveal", () => {
    expect(PLANS.free.maxLevel).toBe(2);
    expect(PLANS.basic.maxLevel).toBe(HINT_LEVELS.length);
    expect(PLANS.advanced.maxLevel).toBe(HINT_LEVELS.length);
  });

  it("C1: plan names are free, basic, advanced with integer monthly credits", () => {
    expect(Object.keys(PLANS)).toEqual(["free", "basic", "advanced"]);
    for (const p of Object.values(PLANS)) expect(Number.isInteger(p.monthlyCredits)).toBe(true);
    expect(PLANS.free.monthlyCredits).toBe(0);
  });
});

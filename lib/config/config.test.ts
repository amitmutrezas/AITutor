import { describe, expect, it } from "vitest";
import { CREDIT_COST_BY_LEVEL, HINT_LEVELS } from "./index";

describe("config", () => {
  it("C2: credit costs per level are integers 0,0,1,2,3", () => {
    expect([...CREDIT_COST_BY_LEVEL]).toEqual([0, 0, 1, 2, 3]);
    expect(CREDIT_COST_BY_LEVEL.every(Number.isInteger)).toBe(true);
  });

  it("H1: there are five named hint levels, one cost each", () => {
    expect([...HINT_LEVELS]).toEqual(["Nudge", "Concept", "Locate", "Scaffold", "Reveal"]);
    expect(HINT_LEVELS.length).toBe(CREDIT_COST_BY_LEVEL.length);
  });
});

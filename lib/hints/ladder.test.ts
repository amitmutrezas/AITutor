import { describe, expect, it } from "vitest";
import { CREDIT_COST_BY_LEVEL } from "../config";
import { LADDER, costForLevel, modelForLevel } from "./ladder";

describe("ladder", () => {
  it("C2: costs come from the config table (0,0,1,2,3)", () => {
    expect(LADDER.map((l) => l.cost)).toEqual([...CREDIT_COST_BY_LEVEL]);
    expect(([1, 2, 3, 4, 5] as const).map(costForLevel)).toEqual([0, 0, 1, 2, 3]);
  });

  it("H1: five named levels; only Reveal has no word cap", () => {
    expect(LADDER.map((l) => l.name)).toEqual(["Nudge", "Concept", "Locate", "Scaffold", "Reveal"]);
    expect(LADDER.map((l) => l.wordCap)).toEqual([120, 120, 120, 120, null]);
  });

  it("N2: model names come from config and differ by level band", () => {
    expect(modelForLevel(1)).toBe(modelForLevel(3));
    expect(modelForLevel(4)).toBe(modelForLevel(5));
    expect(modelForLevel(1)).not.toBe(modelForLevel(4));
  });
});

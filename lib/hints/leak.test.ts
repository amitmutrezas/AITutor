import { describe, expect, it } from "vitest";
import { leakCheck } from "./leak";
import { exercise } from "./test-fixtures";

const sol = exercise.referenceSolution;

describe("leakCheck", () => {
  it("H4: verbatim solution is a leak", () => {
    expect(leakCheck(sol, sol).leaked).toBe(true);
  });

  it("H4: renamed and reformatted solution is a leak", () => {
    const renamed = "function f(a){let t=0;for(const x of a){if(x%2===0)t+=x;}return t;}";
    expect(leakCheck(renamed, sol).leaked).toBe(true);
  });

  it("H4: solution hidden in comments is a leak", () => {
    const commented = sol
      .split("\n")
      .map((l) => `// ${l}`)
      .join("\n");
    expect(leakCheck(commented, sol).leaked).toBe(true);
  });

  it("H4: a plain-language hint passes", () => {
    expect(
      leakCheck("How can you tell whether a number is even? Try the remainder operator.", sol),
    ).toMatchObject({
      leaked: false,
    });
  });

  it("H4: fails closed on bad input", () => {
    expect(leakCheck("hint", "").leaked).toBe(true);
    expect(leakCheck(undefined as unknown as string, sol)).toMatchObject({
      leaked: true,
      reason: "invalid-input",
    });
  });
});

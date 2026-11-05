import { describe, expect, it } from "vitest";
import { buildHintPrompt } from "./prompt";
import { SECRET_MARKER, exercise, learnerCode, stripSolution } from "./test-fixtures";
import type { HintLevel } from "./types";

const all = (p: { system: string; user: string }) => `${p.system}\n${p.user}`;

describe("prompt builder", () => {
  it("H2: levels 1-3 prompt never contains solution", () => {
    for (const level of [1, 2, 3] as const) {
      const p = buildHintPrompt({ level, exercise: stripSolution(exercise), learnerCode });
      expect(all(p)).not.toContain(SECRET_MARKER);
      expect(all(p)).not.toContain(exercise.referenceSolution);
    }
  });

  it("H2: levels 1-3 ignore a referenceSolution passed at runtime anyway", () => {
    for (const level of [1, 2, 3] as const) {
      // Bypass the types on purpose: simulates a buggy caller.
      const sneaky = { level, exercise: { ...exercise }, learnerCode } as unknown as Parameters<
        typeof buildHintPrompt
      >[0];
      const p = buildHintPrompt(sneaky);
      expect(all(p)).not.toContain(SECRET_MARKER);
      expect(all(p)).not.toContain("return " + SECRET_MARKER);
    }
  });

  it("H2: types reject a solution at levels 1-3", () => {
    // @ts-expect-error levels 1-3 cannot be given an exercise carrying referenceSolution
    buildHintPrompt({ level: 2, exercise, learnerCode });
    // @ts-expect-error levels 4-5 require the solution
    buildHintPrompt({ level: 4, exercise: stripSolution(exercise), learnerCode });
  });

  it("H3: levels 4-5 include the solution", () => {
    for (const level of [4, 5] as const) {
      const p = buildHintPrompt({ level, exercise, learnerCode });
      expect(p.user).toContain(exercise.referenceSolution);
    }
  });

  it("H1: each level carries its own instruction and word cap", () => {
    const prompts = ([1, 2, 3, 4, 5] as HintLevel[]).map((level) =>
      level >= 4
        ? buildHintPrompt({ level: level as 4 | 5, exercise, learnerCode })
        : buildHintPrompt({
            level: level as 1 | 2 | 3,
            exercise: stripSolution(exercise),
            learnerCode,
          }),
    );
    expect(new Set(prompts.map((p) => p.system)).size).toBe(5);
    expect(prompts[0].system).toContain("at most 120 words");
    expect(prompts[4].system).toContain("No word cap");
  });
});

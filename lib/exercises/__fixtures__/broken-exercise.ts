import type { Exercise } from "../schema.ts";

/** Deliberately broken: the reference solution is wrong (E2). */
export const brokenReference: Exercise = {
  id: "broken-reference",
  title: "Broken",
  statement: "Return the double of n.",
  language: "javascript",
  starterCode: "function double(n) {}\n",
  tests: "test('doubles', () => { assert.equal(double(2), 4); });",
  referenceSolution: "function double(n) { return n + 1; }\n",
  fallbackHints: ["a", "b", "c", "d", "e"],
  status: "live",
};

/** Deliberately broken: the starter code already passes (E4). */
export const alreadySolved: Exercise = {
  ...brokenReference,
  id: "already-solved",
  starterCode: "function double(n) { return n * 2; }\n",
  referenceSolution: "function double(n) { return n * 2; }\n",
};

/** Deliberately broken: a level 1 fallback hint copies a line of the solution. */
export const leakyHint: Exercise = {
  ...brokenReference,
  id: "leaky-hint",
  referenceSolution: "function double(n) {\n  return n * 2;\n}\n",
  fallbackHints: ["return n * 2;", "b", "c", "d", "e"],
};

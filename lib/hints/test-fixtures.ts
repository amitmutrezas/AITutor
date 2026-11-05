import type { ExerciseWithSolution, HintModel, ModelResult } from "./types";

export const SECRET_MARKER = "zzSecretAccumulator";

export const exercise: ExerciseWithSolution = {
  id: "ex-test",
  title: "Sum of evens",
  statement: "Return the sum of the even numbers in an array.",
  starterCode: "function sumEvens(nums) {\n  // TODO\n}\n",
  tests: "expect(sumEvens([1,2,3,4])).toBe(6);",
  fallbackHints: ["fb1", "fb2", "fb3", "fb4", "fb5"],
  referenceSolution: `function sumEvens(nums) {
  let ${SECRET_MARKER} = 0;
  for (const n of nums) {
    if (n % 2 === 0) ${SECRET_MARKER} += n;
  }
  return ${SECRET_MARKER};
}
`,
};

export const learnerCode = "function sumEvens(nums) { return nums.length; } // LEARNER_SECRET_CODE";

export function stripSolution(e: ExerciseWithSolution) {
  const { referenceSolution: _omit, ...rest } = e;
  void _omit;
  return rest;
}

export function fakeModel(
  impl: (n: number) => ModelResult | Promise<ModelResult>,
): HintModel & { calls: number } {
  const m = {
    calls: 0,
    async complete() {
      m.calls++;
      return impl(m.calls);
    },
  };
  return m;
}

export const goodText =
  "Think about which numbers should be added: how can you tell if a number is even?";

/** In-memory CreditsPort modelling atomicity: check-and-decrement happens in one synchronous step. */
export function inMemoryCredits(balances: Record<string, number>) {
  return {
    balances,
    reserved: 0,
    released: 0,
    async reserve(userId: string, cost: number) {
      if ((this.balances[userId] ?? 0) < cost) return false;
      this.balances[userId] -= cost;
      this.reserved += cost;
      return true;
    },
    async release(userId: string, cost: number) {
      this.balances[userId] = (this.balances[userId] ?? 0) + cost;
      this.released += cost;
    },
  };
}

// TEMP: in-memory sample exercises until M4/M5 wire real data (content/exercises via the API).
// Delete this file when the exercise list and workspace read real exercises.
import type { RunnableExercise } from "../../lib/runner/types";

export const SAMPLE_EXERCISES: RunnableExercise[] = [
  {
    id: "sum-array",
    title: "Sum an array",
    statement:
      "Write a function sum(numbers) that returns the total of all numbers in the array.\nsum([]) should return 0.",
    starterCode: "function sum(numbers) {\n  // your code here\n  return 0;\n}\n",
    tests: `
test("sums a few numbers", () => { assert.equal(sum([1, 2, 3]), 6, "sum([1, 2, 3]) should be 6"); });
test("empty array is 0", () => { assert.equal(sum([]), 0, "sum([]) should be 0"); });
test("handles negatives", () => { assert.equal(sum([-1, 1, 5]), 5, "sum([-1, 1, 5]) should be 5"); });
`,
  },
  {
    id: "is-palindrome",
    title: "Palindrome check",
    statement:
      "Write isPalindrome(text) that returns true when text reads the same forwards and backwards, ignoring case.",
    starterCode: "function isPalindrome(text) {\n  // your code here\n}\n",
    tests: `
test("simple palindrome", () => { assert.equal(isPalindrome("level"), true, 'isPalindrome("level") should be true'); });
test("ignores case", () => { assert.equal(isPalindrome("Racecar"), true, 'isPalindrome("Racecar") should be true'); });
test("not a palindrome", () => { assert.equal(isPalindrome("hello"), false, 'isPalindrome("hello") should be false'); });
`,
  },
];

export function findSample(id: string): RunnableExercise | undefined {
  return SAMPLE_EXERCISES.find((e) => e.id === id);
}

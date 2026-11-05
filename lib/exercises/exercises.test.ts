import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runTests } from "./runTests.ts";
import { exerciseSchema, toExerciseForHint } from "./schema.ts";
import { isVerifyFailure, nextStatus, verifyExercise } from "./verify.ts";
import { alreadySolved, brokenReference, leakyHint } from "./__fixtures__/broken-exercise.ts";

const dir = join(process.cwd(), "content", "exercises");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

describe("E1: exercise schema", () => {
  it("E1: every file in content/exercises matches the schema", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(exerciseSchema.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8"))).success, f).toBe(true);
    }
  });
  it("E1: fallbackHints must be exactly 5 strings", () => {
    expect(exerciseSchema.safeParse({ ...brokenReference, fallbackHints: ["a", "b"] }).success).toBe(false);
  });
  it("E1: toExerciseForHint drops referenceSolution", () => {
    expect("referenceSolution" in toExerciseForHint(brokenReference)).toBe(false);
  });
});

describe("E2/E4: verify", () => {
  it("E2: seed exercise passes on reference and fails on starter", () => {
    const seed = exerciseSchema.parse(JSON.parse(readFileSync(join(dir, "sum-of-array.json"), "utf8")));
    const report = verifyExercise(seed);
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.starterResults.some((r) => !r.passed)).toBe(true);
  });
  it("E2: verify fails when the reference solution fails a test", () => {
    const r = verifyExercise(brokenReference);
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/reference solution fails/);
  });
  it("E4: verify fails when the starter code already passes", () => {
    const r = verifyExercise(alreadySolved);
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/already solved/);
  });
  it("E1: verify fails when a level 1-3 fallback hint contains solution code", () => {
    expect(verifyExercise(leakyHint).problems.join()).toMatch(/level 1/);
  });
  it("E2: only a passing exercise becomes verified; live is never demoted silently", () => {
    expect(nextStatus("draft", true)).toBe("verified");
    expect(nextStatus("verified", false)).toBe("draft");
    expect(nextStatus("live", false)).toBe("live");
  });
});

describe("E2: runTests", () => {
  it("E2: reports per-test pass/fail with messages", () => {
    const { results } = runTests({
      code: "function f(){return 1}",
      tests: "test('a',()=>assert.equal(f(),1));test('b',()=>assert.equal(f(),2));",
    });
    expect(results[0]).toEqual({ name: "a", passed: true });
    expect(results[1]?.passed).toBe(false);
    expect(results[1]?.message).toMatch(/expected 2 but got 1/);
  });
  it("E2: an infinite loop times out instead of hanging", () => {
    const { results } = runTests({ code: "while(true){}", tests: "test('x',()=>{})", timeoutMs: 50 });
    expect(results[0]?.passed).toBe(false);
  });
  it("E2: code cannot reach host globals", () => {
    const { results } = runTests({ code: "", tests: "test('no process',()=>assert(typeof process==='undefined'));" });
    expect(results[0]?.passed).toBe(true);
  });
});

describe("E2: status persistence rules", () => {
  it("E2: a live or verified exercise that fails verification is a failure; a draft is not", () => {
    expect(isVerifyFailure("live", false)).toBe(true);
    expect(isVerifyFailure("verified", false)).toBe(true);
    expect(isVerifyFailure("draft", false)).toBe(false);
    expect(isVerifyFailure("verified", true)).toBe(false);
  });
});

describe("E2: assert.deepEqual is structural", () => {
  const eq = (a: string, b: string) => runTests({ code: "", tests: `test('t',()=>assert.deepEqual(${a},${b}));` }).results[0]?.passed;
  it("E2: key order is ignored", () => {
    expect(eq("{a:1,b:2}", "{b:2,a:1}")).toBe(true);
  });
  it("E2: a missing key differs from undefined", () => {
    expect(eq("{a:1}", "{a:1,b:undefined}")).toBe(false);
    expect(eq("{a:undefined}", "{}")).toBe(false);
  });
  it("E2: nested structures compare deeply", () => {
    expect(eq("{a:[1,{b:[2]}]}", "{a:[1,{b:[2]}]}")).toBe(true);
    expect(eq("{a:[1,{b:[2]}]}", "{a:[1,{b:[3]}]}")).toBe(false);
  });
  it("E2: NaN equals NaN, but null differs from undefined and 1 from '1'", () => {
    expect(eq("NaN", "NaN")).toBe(true);
    expect(eq("[NaN]", "[NaN]")).toBe(true);
    expect(eq("null", "undefined")).toBe(false);
    expect(eq("1", "'1'")).toBe(false);
  });
  it("E2: array holes differ from undefined", () => {
    expect(eq("[1,,3]", "[1,undefined,3]")).toBe(false);
    expect(eq("[1,2]", "[1,2,3]")).toBe(false);
  });
  it("E2: Date compares by time", () => {
    expect(eq("new Date(5)", "new Date(5)")).toBe(true);
    expect(eq("new Date(5)", "new Date(6)")).toBe(false);
  });
  it("E2: arrays and objects are different kinds", () => {
    expect(eq("[]", "{}")).toBe(false);
  });
  const PLAIN_ONLY = "deepEqual supports plain data only (objects, arrays, primitives, Date); compare Map/Set/cycles/class instances manually";
  const msg = (a: string, b: string, code = "") =>
    runTests({ code, tests: `test('t',()=>assert.deepEqual(${a},${b}));` }).results[0]?.message;
  it("E2: Map, Set, functions, symbols, typed arrays and class instances throw the plain-data error", () => {
    expect(msg("new Map()", "new Map()")).toBe(PLAIN_ONLY);
    expect(msg("new Set([1])", "new Set([1])")).toBe(PLAIN_ONLY);
    expect(msg("function(){}", "1")).toBe(PLAIN_ONLY);
    expect(msg("Symbol('a')", "Symbol('a')")).toBe(PLAIN_ONLY);
    expect(msg("new Uint8Array(1)", "new Uint8Array(1)")).toBe(PLAIN_ONLY);
    expect(msg("{a:new Map()}", "{a:1}")).toBe(PLAIN_ONLY);
    expect(msg("new P()", "new P()", "class P {}")).toBe(PLAIN_ONLY);
    expect(msg("Object.create(null)", "{}")).toBe(PLAIN_ONLY);
  });
  it("E2: cyclic structures throw the plain-data error", () => {
    expect(msg("a", "b", "var a={}; a.self=a; var b={}; b.self=b;")).toBe(PLAIN_ONLY);
  });
});

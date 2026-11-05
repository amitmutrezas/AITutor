import vm from "node:vm";

export interface TestResult {
  name: string;
  passed: boolean;
  message?: string;
}

export interface RunTestsInput {
  code: string;
  /** Test source. API: test(name, fn); assert(cond, msg); assert.equal(a, b); assert.deepEqual(a, b). */
  tests: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 1000;

// Runs inside the vm context before any solution code. It is an IIFE, so results and helpers live in a closure,
// not in globals the solution could reassign. Built-ins are captured up front, then everything exposed is frozen.
// Same-realm tampering is defence in depth, not a security boundary: every exercise is human-reviewed
// before it goes live (POLICY 5.1).
const HARNESS = `(function () {
  var results = [];
  var keys = Object.keys, ownKeys = Reflect.ownKeys, getProto = Object.getPrototypeOf, is = Object.is;
  var objProto = Object.prototype, arrProto = Array.prototype, dateProto = Date.prototype;
  var hasOwn = Object.prototype.hasOwnProperty, isEnum = Object.prototype.propertyIsEnumerable;
  var stringify = JSON.stringify, isArray = Array.isArray, makeError = Error, toStr = String;
  var PLAIN_ONLY = "deepEqual supports plain data only (objects, arrays, primitives, Date); compare Map/Set/cycles/class instances manually";

  function show(v) { try { var s = stringify(v); return s === undefined ? toStr(v) : s; } catch (e) { return toStr(v); } }
  function check(v, stack) {
    if (typeof v === "function" || typeof v === "symbol") throw new makeError(PLAIN_ONLY);
    if (typeof v !== "object" || v === null) return;
    var p = getProto(v);
    if (p !== objProto && p !== arrProto && p !== dateProto) throw new makeError(PLAIN_ONLY);
    if (stack.indexOf(v) !== -1) throw new makeError(PLAIN_ONLY);
    var all = ownKeys(v);
    for (var i = 0; i < all.length; i++) { if (typeof all[i] === "symbol") throw new makeError(PLAIN_ONLY); }
  }
  function eq(a, b, stack) {
    check(a, stack);
    check(b, stack);
    if (is(a, b)) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    if (getProto(a) !== getProto(b)) return false;
    if (a instanceof Date) return is(a.getTime(), b.getTime());
    stack.push(a, b);
    try {
      if (isArray(a)) {
        if (a.length !== b.length) return false;
        for (var j = 0; j < a.length; j++) {
          if ((j in a) !== (j in b)) return false;
          if ((j in a) && !eq(a[j], b[j], stack)) return false;
        }
      }
      var ka = keys(a), kb = keys(b);
      if (ka.length !== kb.length) return false;
      for (var k = 0; k < ka.length; k++) {
        var key = ka[k];
        if (!hasOwn.call(b, key) || !isEnum.call(b, key)) return false;
        if (!eq(a[key], b[key], stack)) return false;
      }
      return true;
    } finally {
      stack.length -= 2;
    }
  }

  function test(name, fn) {
    try { fn(); results.push({ name: toStr(name), passed: true }); }
    catch (e) { results.push({ name: toStr(name), passed: false, message: toStr(e && e.message ? e.message : e) }); }
  }
  function assert(cond, msg) { if (!cond) throw new makeError(msg || "assertion failed"); }
  assert.equal = function (a, b, msg) { if (a !== b) throw new makeError(msg || "expected " + show(b) + " but got " + show(a)); };
  assert.deepEqual = function (a, b, msg) { if (!eq(a, b, [])) throw new makeError(msg || "expected " + show(b) + " but got " + show(a)); };
  Object.freeze(assert.equal); Object.freeze(assert.deepEqual); Object.freeze(assert); Object.freeze(test);

  function getResults() { return stringify(results); }
  return [test, assert, getResults];
})()`;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Pure runner for the offline verify script. Learner code in production runs in the browser worker (M3).
 * The time limit applies to the code and to the whole test script, each run synchronously.
 * The tests run inside a function whose parameters are `test` and `assert`, bound to references captured
 * before the solution ran, so a solution that redeclares or reassigns them cannot change what the tests call.
 * A solution that throws or has a top-level return fails to load, and zero registered tests is a failure.
 */
export function runTests({ code, tests, timeoutMs = DEFAULT_TIMEOUT_MS }: RunTestsInput): { results: TestResult[] } {
  const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
  const harness = vm.runInContext(HARNESS, context) as [unknown, unknown, () => string];
  const getResults = harness[2];
  const collect = (): TestResult[] => JSON.parse(getResults()) as TestResult[];

  try {
    vm.runInContext(code, context, { timeout: timeoutMs });
  } catch (e) {
    return { results: [{ name: "load code", passed: false, message: errorMessage(e) }] };
  }

  // Compile the tests as a function of (test, assert) and call it from a context-side trampoline so the time limit applies.
  const key = `__run_${Math.random().toString(36).slice(2)}`;
  try {
    const testsFn = vm.runInContext(`(function (test, assert) {\n${tests}\n})`, context);
    Object.assign(context, { [key]: { testsFn, test: harness[0], assert: harness[1] } });
    vm.runInContext(`${key}.testsFn(${key}.test, ${key}.assert)`, context, { timeout: timeoutMs });
  } catch (e) {
    return { results: [...collect(), { name: "run tests", passed: false, message: errorMessage(e) }] };
  }
  const results = collect();
  if (results.length === 0) {
    return { results: [{ name: "no tests", passed: false, message: "tests registered no test() calls" }] };
  }
  return { results };
}

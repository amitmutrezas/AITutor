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

// Runs inside the vm context. Kept as a string so no host-realm objects leak in.
const HARNESS = `
var __results = [];
function __show(v) { try { var s = JSON.stringify(v); return s === undefined ? String(v) : s; } catch (e) { return String(v); } }
function test(name, fn) {
  try { fn(); __results.push({ name: String(name), passed: true }); }
  catch (e) { __results.push({ name: String(name), passed: false, message: String(e && e.message ? e.message : e) }); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
assert.equal = function (a, b, msg) { if (a !== b) throw new Error(msg || "expected " + __show(b) + " but got " + __show(a)); };
assert.deepEqual = function (a, b, msg) { if (!__eq(a, b, [])) throw new Error(msg || "expected " + __show(b) + " but got " + __show(a)); };
function __eq(a, b, seen) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  for (var i = 0; i < seen.length; i++) { if (seen[i][0] === a && seen[i][1] === b) return true; }
  seen.push([a, b]);
  if (a instanceof Date) return Object.is(a.getTime(), b.getTime());
  if (a instanceof Map) {
    if (a.size !== b.size) return false;
    var ok = true;
    a.forEach(function (v, k) { if (ok && (!b.has(k) || !__eq(v, b.get(k), seen))) ok = false; });
    return ok;
  }
  if (a instanceof Set) {
    if (a.size !== b.size) return false;
    var okSet = true;
    a.forEach(function (v) { if (okSet && !b.has(v)) okSet = false; });
    return okSet;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (var j = 0; j < a.length; j++) {
      if ((j in a) !== (j in b)) return false;
      if ((j in a) && !__eq(a[j], b[j], seen)) return false;
    }
  }
  var ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (var k = 0; k < ka.length; k++) {
    var key = ka[k];
    if (!Object.prototype.hasOwnProperty.call(b, key) || !Object.prototype.propertyIsEnumerable.call(b, key)) return false;
    if (!__eq(a[key], b[key], seen)) return false;
  }
  return true;
}
`;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Pure runner for the offline verify script. Learner code in production runs in the browser worker (M3).
 * The time limit applies to the code and to the whole test script, each run synchronously.
 */
export function runTests({ code, tests, timeoutMs = DEFAULT_TIMEOUT_MS }: RunTestsInput): { results: TestResult[] } {
  const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(HARNESS, context);
  const collect = (): TestResult[] => JSON.parse(vm.runInContext("JSON.stringify(__results)", context)) as TestResult[];

  try {
    vm.runInContext(code, context, { timeout: timeoutMs });
  } catch (e) {
    return { results: [{ name: "load code", passed: false, message: errorMessage(e) }] };
  }
  try {
    vm.runInContext(tests, context, { timeout: timeoutMs });
  } catch (e) {
    return { results: [...collect(), { name: "run tests", passed: false, message: errorMessage(e) }] };
  }
  const results = collect();
  if (results.length === 0) {
    return { results: [{ name: "no tests", passed: false, message: "tests registered no test() calls" }] };
  }
  return { results };
}

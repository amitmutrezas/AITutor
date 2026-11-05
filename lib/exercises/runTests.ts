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
var __PLAIN_ONLY = "deepEqual supports plain data only (objects, arrays, primitives, Date); compare Map/Set/cycles/class instances manually";
function __check(v, stack) {
  if (typeof v === "function" || typeof v === "symbol") throw new Error(__PLAIN_ONLY);
  if (typeof v !== "object" || v === null) return;
  var p = Object.getPrototypeOf(v);
  if (p !== Object.prototype && p !== Array.prototype && p !== Date.prototype) throw new Error(__PLAIN_ONLY);
  if (stack.indexOf(v) !== -1) throw new Error(__PLAIN_ONLY);
}
function __eq(a, b, stack) {
  __check(a, stack);
  __check(b, stack);
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (a instanceof Date) return Object.is(a.getTime(), b.getTime());
  stack.push(a, b);
  try {
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (var j = 0; j < a.length; j++) {
        if ((j in a) !== (j in b)) return false;
        if ((j in a) && !__eq(a[j], b[j], stack)) return false;
      }
    }
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var k = 0; k < ka.length; k++) {
      var key = ka[k];
      if (!Object.prototype.hasOwnProperty.call(b, key) || !Object.prototype.propertyIsEnumerable.call(b, key)) return false;
      if (!__eq(a[key], b[key], stack)) return false;
    }
    return true;
  } finally {
    stack.length -= 2;
  }
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

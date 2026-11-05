/**
 * Test API available to exercise `tests` sources (same tiny API as M1's exercise schema).
 *
 *   test(name, fn)            register a test; fn may be async. A throw means failure.
 *   assert(cond, message?)    fails with `message` when cond is falsy.
 *   assert.equal(a, b, msg?)  strict equality (Object.is); also assert.deepEqual(a, b, msg?)
 *                             compares plain data structurally (primitives, arrays, plain
 *                             objects, Date). Map/Set/cycles/functions/class instances throw.
 *
 * The tests source runs in the same scope as the learner's code, so tests can call the
 * functions the learner defined. Example:
 *
 *   test("adds", () => { assert.equal(add(1, 2), 3, "add(1, 2) should be 3"); });
 *
 * TEST_API_SOURCE is plain JavaScript text so it can run inside the Worker and inside
 * Vitest from one source of truth. It defines `makeTestApi()` returning
 * { test, assert, run }.
 */
export const TEST_API_SOURCE = `
function makeTestApi() {
  var tests = [];
  function fail(message) { var e = new Error(message); e.name = "AssertionError"; throw e; }
  function assert(cond, message) { if (!cond) fail(message || "Assertion failed"); }
  assert.equal = function (a, b, message) {
    if (!Object.is(a, b)) fail(message || "Expected " + show(b) + " but got " + show(a));
  };
  assert.deepEqual = function (a, b, message) {
    if (!deepEq(a, b, [])) fail(message || "Expected " + show(b) + " but got " + show(a));
  };
  // Captured before learner code runs. Date detection is a brand check (getTime throws on
  // non-Dates) plus a prototype check; Symbol.toStringTag is never trusted.
  var dateGetTime = Date.prototype.getTime;
  var datePrototype = Date.prototype;
  var ownKeys = Reflect.ownKeys;
  function isDate(v) {
    if (Object.getPrototypeOf(v) !== datePrototype) return false;
    try { dateGetTime.call(v); return true; } catch (e) { return false; }
  }
  var UNSUPPORTED = "deepEqual supports plain data only (objects, arrays, primitives, Date); " +
    "compare Map/Set/cycles/class instances manually";
  // JSON-like data only; anything else throws (fails closed). Primitives via Object.is (NaN
  // equals NaN), arrays element-wise (holes differ from undefined), plain objects by own
  // enumerable key set (order ignored, missing differs from undefined), Date by time value.
  // stack holds the objects being compared so a cycle is detected and rejected.
  function checkSupported(v, stack) {
    var t = typeof v;
    if (t === "function" || t === "symbol") throw new Error(UNSUPPORTED);
    if (t !== "object" || v === null) return;
    if (stack.indexOf(v) !== -1) throw new Error(UNSUPPORTED);
    // Symbol-keyed own properties are invisible to Object.keys, so reject them outright.
    var keys = ownKeys(v);
    for (var k = 0; k < keys.length; k++) if (typeof keys[k] === "symbol") throw new Error(UNSUPPORTED);
    if (Array.isArray(v) || isDate(v)) return;
    var proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw new Error(UNSUPPORTED);
  }
  function deepEq(a, b, stack) {
    checkSupported(a, stack);
    checkSupported(b, stack);
    // Objects are always traversed (even when identical) so cycles are detected and rejected.
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
      return Object.is(a, b);
    }
    var aDate = isDate(a), bDate = isDate(b);
    if (aDate || bDate) return aDate && bDate && Object.is(dateGetTime.call(a), dateGetTime.call(b));
    var aArr = Array.isArray(a), i;
    if (aArr !== Array.isArray(b)) return false;
    stack.push(a, b);
    try {
      if (aArr) {
        if (a.length !== b.length) return false;
        for (i = 0; i < a.length; i++) {
          if ((i in a) !== (i in b)) return false;
          if (!deepEq(a[i], b[i], stack)) return false;
        }
        return true;
      }
      var ka = Object.keys(a), kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      for (i = 0; i < ka.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(b, ka[i])) return false;
        if (!deepEq(a[ka[i]], b[ka[i]], stack)) return false;
      }
      return true;
    } finally {
      stack.length -= 2;
    }
  }
  function show(v) {
    if (v === undefined) return "undefined";
    if (typeof v === "function") return "[function]";
    if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
    try { return JSON.stringify(v, function (k, x) { return x === undefined ? "undefined" : (typeof x === "number" && !isFinite(x) ? String(x) : x); }); } catch (e) { return String(v); }
  }
  function test(name, fn) { tests.push({ name: String(name), fn: fn }); }
  function describeError(e) {
    return e && e.message ? String(e.message) : String(e);
  }
  async function run() {
    if (tests.length === 0) throw new Error("No tests were registered by the exercise");
    var results = [];
    for (var i = 0; i < tests.length; i++) {
      try { await tests[i].fn(); results.push({ name: tests[i].name, passed: true, message: "" }); }
      catch (e) { results.push({ name: tests[i].name, passed: false, message: describeError(e) }); }
    }
    return results;
  }
  // Frozen so learner code cannot do assert.equal = () => {}. This protects honest progress
  // tracking only: results are never trusted server side (solved state is local), so it is not
  // a trust boundary.
  Object.freeze(assert.equal);
  Object.freeze(assert.deepEqual);
  Object.freeze(assert);
  Object.freeze(test);
  return Object.freeze({ test: test, assert: assert, run: run });
}
`;

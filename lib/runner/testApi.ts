/**
 * Test API available to exercise `tests` sources (same tiny API as M1's exercise schema).
 *
 *   test(name, fn)            register a test; fn may be async. A throw means failure.
 *   assert(cond, message?)    fails with `message` when cond is falsy.
 *   assert.equal(a, b, msg?)  strict equality (Object.is); also assert.deepEqual(a, b, msg?)
 *                             compares JSON-serialisable values structurally.
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
  // Structural comparison: primitives via Object.is, arrays element-wise, plain objects by own
  // enumerable key set (order ignored, missing differs from undefined), Date, Map, Set, NaN.
  // seen holds [a, b] pairs being compared so cycles terminate.
  function deepEq(a, b, seen) {
    if (Object.is(a, b)) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    for (var s = 0; s < seen.length; s++) if (seen[s][0] === a && seen[s][1] === b) return true;
    seen.push([a, b]);
    var tag = Object.prototype.toString.call(a);
    if (tag !== Object.prototype.toString.call(b)) return false;
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    var i;
    if (tag === "[object Date]") return Object.is(a.getTime(), b.getTime());
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (i = 0; i < a.length; i++) {
        if ((i in a) !== (i in b)) return false;
        if (!deepEq(a[i], b[i], seen)) return false;
      }
      return true;
    }
    if (tag === "[object Map]") {
      if (a.size !== b.size) return false;
      var ok = true;
      a.forEach(function (v, k) { if (!b.has(k) || !deepEq(v, b.get(k), seen)) ok = false; });
      return ok;
    }
    if (tag === "[object Set]") {
      if (a.size !== b.size) return false;
      var found = true;
      a.forEach(function (v) {
        if (b.has(v)) return;
        var match = false;
        b.forEach(function (w) { if (!match && deepEq(v, w, seen.slice())) match = true; });
        if (!match) found = false;
      });
      return found;
    }
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (i = 0; i < ka.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(b, ka[i])) return false;
      if (!deepEq(a[ka[i]], b[ka[i]], seen)) return false;
    }
    return true;
  }
  function show(v) {
    if (v === undefined) return "undefined";
    if (typeof v === "function") return "[function]";
    if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
    if (v instanceof Map) return "Map(" + show(Array.from(v.entries())) + ")";
    if (v instanceof Set) return "Set(" + show(Array.from(v.values())) + ")";
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

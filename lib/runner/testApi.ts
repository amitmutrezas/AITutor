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
    var x = show(a), y = show(b);
    if (x !== y) fail(message || "Expected " + y + " but got " + x);
  };
  function show(v) {
    if (v === undefined) return "undefined";
    if (typeof v === "function") return "[function]";
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  function test(name, fn) { tests.push({ name: String(name), fn: fn }); }
  function describeError(e) {
    return e && e.message ? String(e.message) : String(e);
  }
  async function run() {
    var results = [];
    for (var i = 0; i < tests.length; i++) {
      try { await tests[i].fn(); results.push({ name: tests[i].name, passed: true, message: "" }); }
      catch (e) { results.push({ name: tests[i].name, passed: false, message: describeError(e) }); }
    }
    return results;
  }
  return { test: test, assert: assert, run: run };
}
`;

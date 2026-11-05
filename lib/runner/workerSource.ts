import { TEST_API_SOURCE } from "./testApi";

/**
 * R1: the Worker body, as plain JavaScript text so it can be served from /runner/worker.js (own CSP) and also
 * evaluated in Vitest with a fake `self`. Network and import APIs are shadowed BEFORE any
 * learner code is evaluated. A Worker has no host DOM by construction.
 *
 * Message in:  { code: string, tests: string, nonce: string }
 * Message out: { type: "done", nonce, results } | { type: "error", nonce, message }
 */
export const WORKER_SOURCE = `
${TEST_API_SOURCE}
(function (scope) {
  // Captured before any learner code exists. Learner code cannot reach this closure.
  var post = scope.postMessage.bind(scope);
  var blocked = ["postMessage", "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts",
    "WebTransport", "BroadcastChannel", "indexedDB", "caches", "Worker", "SharedWorker"];
  var stubs = blocked.map(function (name) {
    var stub = function () { throw new Error(name + " is disabled in the exercise sandbox"); };
    try {
      Object.defineProperty(scope, name, { configurable: false, writable: false, value: stub });
    } catch (e) { try { scope[name] = stub; } catch (e2) {} }
    return stub;
  });
  scope.onmessage = async function (ev) {
    var data = ev.data || {};
    // Per-run secret from the host. Replies without it are ignored, so a forged "done"
    // message posted by learner code is dropped.
    var nonce = String(data.nonce);
    try {
      var api = makeTestApi();
      // The harness is handed in under a per-run hidden parameter name. The tests run inside an
      // inner function whose parameters are test and assert, bound to references captured here
      // before learner code is evaluated, so re-declaring assert/test in learner code (or
      // mutating them, they are frozen) cannot change what the tests call. Not a trust boundary:
      // results are never trusted server side.
      var hidden = "__h_" + nonce.replace(/[^a-z0-9]/gi, "");
      var body = String(data.code) + "\\n;\\n" + "return " + hidden +
        ".run(function (test, assert) {\\n" + String(data.tests) + "\\n}, " + hidden + ");";
      // Blocked names are also bound as parameters, so learner code sees the stubs even if a
      // global could not be redefined.
      var fn = Function.apply(null, [hidden, "test", "assert"].concat(blocked, [body]));
      var harness = Object.freeze({
        run: function (testsFn) { testsFn(api.test, api.assert); return api.run(); },
      });
      var results = await fn.apply(null, [harness, api.test, api.assert].concat(stubs));
      post({ type: "done", nonce: nonce, results: results });
    } catch (e) {
      post({ type: "error", nonce: nonce, message: e && e.message ? String(e.message) : String(e) });
    }
  };
})(self);
`;

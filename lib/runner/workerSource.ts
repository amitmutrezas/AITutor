import { TEST_API_SOURCE } from "./testApi";

/**
 * R1: the Worker body, as plain JavaScript text so it can be loaded from a Blob URL and also
 * evaluated in Vitest with a fake `self`. Network and import APIs are shadowed BEFORE any
 * learner code is evaluated. A Worker has no host DOM by construction.
 *
 * Message in:  { code: string, tests: string }
 * Message out: { type: "done", results } | { type: "error", message }
 */
export const WORKER_SOURCE = `
${TEST_API_SOURCE}
(function (scope) {
  var blocked = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts",
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
    try {
      var api = makeTestApi();
      var body = String(data.code) + "\\n;\\n" + String(data.tests);
      // Blocked names are also bound as parameters, so learner code sees the stubs even if a
      // global could not be redefined.
      var fn = Function.apply(null, ["test", "assert"].concat(blocked, [body]));
      fn.apply(null, [api.test, api.assert].concat(stubs));
      var results = await api.run();
      scope.postMessage({ type: "done", results: results });
    } catch (e) {
      scope.postMessage({ type: "error", message: e && e.message ? String(e.message) : String(e) });
    }
  };
})(self);
`;

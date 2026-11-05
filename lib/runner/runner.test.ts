import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { allPassed, shapeResults } from "./results";
import { runInSandbox, type WorkerLike } from "./run";
import { WORKER_SOURCE } from "./workerSource";

type FakeScope = Record<string, unknown> & { onmessage?: (ev: { data: unknown }) => Promise<void> };
type Posted = { type: string; results?: { name: string; passed: boolean; message: string }[]; message?: string };

/** Evaluate the real worker source against a fake global scope. */
function bootWorker() {
  const posted: unknown[] = [];
  const scope: FakeScope = {
    fetch: () => "real fetch",
    postMessage: (m: unknown) => posted.push(m),
  };
  new Function("self", WORKER_SOURCE)(scope);
  const send = async (code: string, tests: string): Promise<Posted> => {
    posted.length = 0;
    await scope.onmessage!({ data: { code, tests, nonce: "n1" } });
    return posted[0] as Posted;
  };
  return { scope, send };
}

describe("R1: sandbox", () => {
  it("R1: network and import APIs are shadowed before learner code runs", async () => {
    const { scope, send } = bootWorker();
    for (const n of ["fetch", "XMLHttpRequest", "WebSocket", "importScripts"]) {
      expect(() => (scope[n] as () => void)()).toThrow(/disabled/);
    }
    const msg = await send(
      "function go() { return fetch('https://example.com'); }",
      "test('no network', () => { go(); });",
    );
    expect(msg.type).toBe("done");
    expect(msg.results![0].passed).toBe(false);
    expect(msg.results![0].message).toMatch(/disabled/);
  });

  it("R1: times out and terminates the worker", async () => {
    vi.useFakeTimers();
    const terminate = vi.fn();
    const hung: WorkerLike = { postMessage() {}, terminate, onmessage: null, onerror: null };
    const p = runInSandbox("while(true){}", "", { timeLimitMs: 2000, factory: () => hung });
    await vi.advanceTimersByTimeAsync(2000);
    const out = await p;
    vi.useRealTimers();
    expect(out.status).toBe("timeout");
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("R1: a worker reply beats the default 2s timer and the worker is terminated", async () => {
    const terminate = vi.fn();
    const w: WorkerLike = {
      postMessage(m) {
        const nonce = (m as { nonce: string }).nonce;
        w.onmessage?.({ data: { type: "done", nonce, results: [{ name: "a", passed: true }] } });
      },
      terminate,
      onmessage: null,
      onerror: null,
    };
    const out = await runInSandbox("", "", { factory: () => w });
    expect(out.status).toBe("ok");
    expect(terminate).toHaveBeenCalledOnce();
  });
});

describe("R1: forged results", () => {
  it("R1: learner code cannot call postMessage to forge a result", async () => {
    const { send } = bootWorker();
    const msg = await send(
      "function f() { postMessage({ type: 'done', results: [{ name: 'x', passed: true }] }); }",
      "test('forge', () => { f(); });",
    );
    expect(msg.type).toBe("done");
    expect(msg.results![0].passed).toBe(false);
    expect(msg.results![0].message).toMatch(/disabled/);
  });

  it("R1: a message without the run nonce is ignored and the real result still wins", async () => {
    const terminate = vi.fn();
    const w: WorkerLike = {
      postMessage(m) {
        const nonce = (m as { nonce: string }).nonce;
        w.onmessage?.({ data: { type: "done", results: [{ name: "fake", passed: true }] } });
        w.onmessage?.({ data: { type: "done", nonce: "wrong", results: [{ name: "fake", passed: true }] } });
        w.onmessage?.({ data: { type: "done", nonce, results: [{ name: "real", passed: false }] } });
      },
      terminate,
      onmessage: null,
      onerror: null,
    };
    const out = await runInSandbox("", "", { factory: () => w });
    expect(out.results.map((r) => r.name)).toEqual(["real"]);
    expect(allPassed(out)).toBe(false);
  });
});

describe("R2: assertion tampering", () => {
  const FAILING = "test('fails', () => { assert.equal(add(1, 2), 3); });";
  const ADD = "function add(a, b) { return a - b; }\n";
  it("R2: assert.equal = () => {} in learner code still leaves failing tests failing", async () => {
    const { send } = bootWorker();
    const msg = await send(ADD + "assert.equal = () => {};", FAILING);
    expect(msg.results![0].passed).toBe(false);
  });
  it("R2: function assert() {} and var test = ... in learner code leave failing tests failing", async () => {
    const { send } = bootWorker();
    const a = await send(ADD + "function assert() {}", FAILING);
    expect(a.results![0].passed).toBe(false);
    const b = await send(ADD + "var test = function () {}; var assert = { equal() {} };", FAILING);
    expect(b.results![0].passed).toBe(false);
  });
  it("R2: the harness test and assert are frozen but readable", async () => {
    const { send } = bootWorker();
    const msg = await send(
      "var ok = Object.isFrozen(assert) && Object.isFrozen(assert.equal) && Object.isFrozen(assert.deepEqual) && Object.isFrozen(test);",
      "test('frozen', () => { if (!ok) throw new Error('harness not frozen'); });",
    );
    expect(msg.results![0].passed).toBe(true);
  });
});

describe("R2: deepEqual and forged results", () => {
  async function eq(a: string, b: string): Promise<boolean> {
    const { send } = bootWorker();
    const msg = await send("", `test('t', () => { assert.deepEqual(${a}, ${b}); });`);
    return msg.results![0].passed;
  }
  it("R2: deepEqual ignores key order", async () => {
    expect(await eq("{a:1,b:2}", "{b:2,a:1}")).toBe(true);
  });
  it("R2: deepEqual treats missing and undefined as different", async () => {
    expect(await eq("{a:1}", "{a:1,b:undefined}")).toBe(false);
    expect(await eq("[1,,3]", "[1,undefined,3]")).toBe(false);
  });
  it("R2: deepEqual handles nested, arrays, NaN, Date, Map, Set, cycles", async () => {
    expect(await eq("{x:[1,{y:[2]}]}", "{x:[1,{y:[2]}]}")).toBe(true);
    expect(await eq("{x:[1,{y:[2]}]}", "{x:[1,{y:[3]}]}")).toBe(false);
    expect(await eq("[1,2]", "[2,1]")).toBe(false);
    expect(await eq("[1,2]", "[1,2,3]")).toBe(false);
    expect(await eq("NaN", "NaN")).toBe(true);
    expect(await eq("[NaN]", "[NaN]")).toBe(true);
    expect(await eq("new Date(5)", "new Date(5)")).toBe(true);
    expect(await eq("new Date(5)", "new Date(6)")).toBe(false);
    expect(await eq("new Map([[1,{a:1}]])", "new Map([[1,{a:1}]])")).toBe(true);
    expect(await eq("new Map([[1,2]])", "new Map([[1,3]])")).toBe(false);
    expect(await eq("new Set([1,2])", "new Set([2,1])")).toBe(true);
    expect(await eq("new Set([1,2])", "new Set([1,3])")).toBe(false);
    expect(await eq("1", "'1'")).toBe(false);
    const cyc = "(()=>{const a={};a.s=a;return a})()";
    expect(await eq(cyc, cyc)).toBe(true);
  });
  it("R2: a top-level return of fake passing results does not pass", async () => {
    const { send } = bootWorker();
    const msg = await send(
      "return [{name:'fake',passed:true,message:''}];",
      "test('real', () => { assert.equal(1, 2); });",
    );
    expect(msg.type).toBe("error");
    expect(msg.results).toBeUndefined();
  });
  it("R2: zero registered tests is an error, not a pass", async () => {
    const { send } = bootWorker();
    const msg = await send("var x = 1;", "var y = 2;");
    expect(msg.type).toBe("error");
  });
});

describe("R2: result shaping", () => {
  it("R2: pass/fail per test with the failing assertion message", async () => {
    const { send } = bootWorker();
    const msg = await send(
      "function add(a, b) { return a - b; }",
      `test('adds', () => { assert.equal(add(1, 2), 3); });
       test('zero', () => { assert(add(0, 0) === 0, 'zero case'); });
       test('custom', () => { assert.equal(add(2, 2), 4, 'add(2, 2) should be 4'); });`,
    );
    const r = msg.results!;
    expect(r.map((x) => [x.name, x.passed])).toEqual([
      ["adds", false],
      ["zero", true],
      ["custom", false],
    ]);
    expect(r[0].message).toBe("Expected 3 but got -1");
    expect(r[2].message).toBe("add(2, 2) should be 4");
  });

  it("R2: syntax errors become an error message, not a crash", async () => {
    const { send } = bootWorker();
    const msg = await send("function (", "test('x', () => {});");
    expect(msg.type).toBe("error");
    expect(msg.message).toBeTruthy();
  });

  it("R2: shapeResults sanitises untrusted output and allPassed needs all green", () => {
    expect(shapeResults("nope")).toEqual([]);
    const r = shapeResults([{ name: "a", passed: true, message: "x" }, { passed: false }]);
    expect(r).toEqual([
      { name: "a", passed: true, message: "" },
      { name: "Test 2", passed: false, message: "Test failed" },
    ]);
    expect(allPassed({ status: "ok", results: r })).toBe(false);
    expect(allPassed({ status: "ok", results: [r[0]] })).toBe(true);
    expect(allPassed({ status: "ok", results: [] })).toBe(false);
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", ".claude", "e2e"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("R3: learner code never runs on our servers", () => {
  it("R3: no server file imports lib/runner", () => {
    const root = process.cwd();
    // Exactly one server file may import from lib/runner, and only workerSource: the route that
    // serves the static worker script text with its own CSP. It never executes learner code.
    const allowed = join(root, "app/runner/worker.js/route.ts");
    const serverFiles = walk(join(root, "app")).filter((f) => /\/api\/|\/route\.ts$/.test(f));
    serverFiles.push(...walk(join(root, "lib")).filter((f) => !f.includes("/lib/runner/")));
    for (const f of serverFiles) {
      if (f.endsWith(".test.ts")) continue;
      const src = readFileSync(f, "utf8");
      if (f === allowed) {
        const imports = [...src.matchAll(/from\s+["']([^"']*runner[^"']*)["']/g)].map((m) => m[1]);
        expect(imports.length).toBe(1);
        expect(imports[0].endsWith("lib/runner/workerSource")).toBe(true);
        continue;
      }
      expect(src, f).not.toMatch(/from\s+["'][^"']*runner[^"']*["']/);
    }
  });
});

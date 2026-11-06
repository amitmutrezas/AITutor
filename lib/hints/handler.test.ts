import { describe, expect, it, vi } from "vitest";
import { InMemoryAccounts } from "../account/service";
import type { Authenticate } from "../auth/types";
import { InMemoryCredits } from "../credits";
import { createHintHandler, createRateLimiter, type HandlerDeps } from "./handler";
import { InMemoryHintLog } from "./hint-log";
import { createInMemoryExerciseStore, type LoadExercise } from "./exercise-store";
import { TtlCache } from "./service";
import { exercise, fakeModel, goodText, learnerCode } from "./test-fixtures";

/** Test fake for the session: the verified user id arrives in a test-only header. */
const testAuth: Authenticate = async (req) => {
  const id = req.headers.get("x-test-user");
  return id ? { id, email: `${id}@example.com` } : null;
};

const paidAccounts = () =>
  new InMemoryAccounts({
    u1: { email: "u1@example.com", planKey: "basic", balance: 0 },
    other: { email: "o@example.com", planKey: "basic", balance: 0 },
  });

function setup(over: Partial<HandlerDeps> = {}) {
  const model = fakeModel(() => ({ text: goodText, tokensIn: 1, tokensOut: 2 }));
  const inner = createInMemoryExerciseStore([exercise]);
  const calls: boolean[] = [];
  const loadExercise = (async (id: string, opts: { withSolution: boolean }) => {
    calls.push(opts.withSolution);
    return (inner as (i: string, o: { withSolution: boolean }) => Promise<unknown>)(id, opts);
  }) as LoadExercise;
  const deps: HandlerDeps = {
    loadExercise,
    model,
    authenticate: testAuth,
    rateLimiter: createRateLimiter(100),
    credits: new InMemoryCredits({ u1: 100, other: 100 }),
    accounts: paidAccounts(),
    hintLog: new InMemoryHintLog(),
    requestHintDeps: { cache: new TtlCache(), log: () => undefined },
    ...over,
  };
  return { post: createHintHandler(deps), model, calls };
}

const req = (body: unknown, user: string | null = "u1") =>
  new Request("http://x/api/hint", {
    method: "POST",
    headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: JSON.stringify(body),
  });
const valid = { exerciseId: exercise.id, level: 2, code: "let x = 1" };

describe("POST /api/hint", () => {
  it("happy path returns a hint without the code", async () => {
    const { post } = setup();
    const res = await post(req(valid));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ hint: goodText, fallback: false, charged: false, cost: 0 });
    expect(JSON.stringify(body)).not.toContain("let x = 1");
  });

  it("unauthenticated is 401 and does not call the model", async () => {
    const { post, model } = setup();
    expect((await post(req(valid, null))).status).toBe(401);
    expect(model.calls).toBe(0);
  });

  it("invalid input and unknown fields are 400", async () => {
    const { post } = setup();
    expect((await post(req({ ...valid, level: 6 }))).status).toBe(400);
    expect((await post(req({ ...valid, level: 1.5 }))).status).toBe(400);
    expect((await post(req({ ...valid, extra: 1 }))).status).toBe(400);
    expect((await post(req({ exerciseId: "a" }))).status).toBe(400);
  });

  it("unknown exercise is 404", async () => {
    const { post } = setup();
    expect((await post(req({ ...valid, exerciseId: "nope" }))).status).toBe(404);
  });

  it("N1: rate limit per user returns 429", async () => {
    const { post } = setup({ rateLimiter: createRateLimiter(2, 60_000) });
    expect((await post(req(valid))).status).toBe(200);
    expect((await post(req({ ...valid, code: "b" }))).status).toBe(200);
    expect((await post(req({ ...valid, code: "c" }))).status).toBe(429);
    expect((await post(req(valid, "other"))).status).toBe(200);
  });

  it("H2: levels 1-3 load the exercise without solution for the prompt", async () => {
    const { post, calls } = setup();
    await post(req(valid));
    expect(calls[0]).toBe(false);
  });

  it("H3: level 5 loads with solution", async () => {
    const { post, calls } = setup();
    await post(req({ ...valid, level: 5 }));
    expect(calls[0]).toBe(true);
  });

  it("C2: insufficient credits refuses before any model call", async () => {
    const credits = new InMemoryCredits({ u1: 0 });
    const { post, model } = setup({ credits });
    const res = await post(req({ ...valid, level: 3 }));
    expect(res.status).toBe(402);
    expect(model.calls).toBe(0);
  });

  it("C2: balance for one hint, two concurrent paid requests: one model call, one 402", async () => {
    const credits = new InMemoryCredits({ u1: 1 });
    const { post, model } = setup({ credits });
    const [a, b] = await Promise.all([
      post(req({ ...valid, level: 3, code: "a" })),
      post(req({ ...valid, level: 3, code: "b" })),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 402]);
    expect(model.calls).toBe(1);
    expect(credits.balances.get("u1")).toBe(0);
  });

  it("C2: a successful paid hint keeps the reservation", async () => {
    const credits = new InMemoryCredits({ u1: 5 });
    const { post } = setup({ credits });
    const res = await post(req({ ...valid, level: 3 }));
    expect(await res.json()).toMatchObject({ charged: true, cost: 1 });
    expect(credits.balances.get("u1")).toBe(4);
  });

  it("C2/H5: a failed hint releases the reservation", async () => {
    const credits = new InMemoryCredits({ u1: 5 });
    const { post } = setup({
      credits,
      model: fakeModel(() => {
        throw new Error("down");
      }),
    });
    const res = await post(req({ ...valid, level: 3 }));
    expect(await res.json()).toMatchObject({ fallback: true, charged: false });
    expect(credits.balances.get("u1")).toBe(5);
  });

  it("C2/H7: a free cache hit releases the reservation", async () => {
    const credits = new InMemoryCredits({ u1: 5 });
    const { post, model } = setup({ credits });
    await post(req({ ...valid, level: 3 }));
    const second = await post(req({ ...valid, level: 3 }));
    expect(await second.json()).toMatchObject({ cached: true, charged: false });
    expect(model.calls).toBe(1);
    expect(credits.balances.get("u1")).toBe(4);
  });

  it("H7: after a paid request drains the balance, a sequential repeat is a free 200", async () => {
    const credits = new InMemoryCredits({ u1: 1 });
    const { post, model } = setup({ credits });
    const first = await post(req({ ...valid, level: 3 }));
    expect(await first.json()).toMatchObject({ charged: true });
    expect(credits.balances.get("u1")).toBe(0);
    const second = await post(req({ ...valid, level: 3 }));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ cached: true, charged: false });
    expect(model.calls).toBe(1);
    expect(credits.balances.get("u1")).toBe(0);
  });

  it("H7: a concurrent identical double click is a free 200, not a 402", async () => {
    const credits = new InMemoryCredits({ u1: 1 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const model = fakeModel(async () => {
      await gate;
      return { text: goodText, tokensIn: 1, tokensOut: 1 };
    });
    const { post } = setup({ credits, model });
    const p1 = post(req({ ...valid, level: 3 }));
    await new Promise((r) => setTimeout(r, 5));
    const p2 = post(req({ ...valid, level: 3 }));
    await new Promise((r) => setTimeout(r, 5));
    release();
    const [a, b] = await Promise.all([p1, p2]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const bodies = [await a.json(), await b.json()];
    expect(bodies.filter((x) => x.charged).length).toBe(1);
    expect(model.calls).toBe(1);
    expect(credits.balances.get("u1")).toBe(0);
  });

  it("C2: two different codes with balance for one still give one 402", async () => {
    const credits = new InMemoryCredits({ u1: 1 });
    const { post, model } = setup({ credits });
    const a = await post(req({ ...valid, level: 3, code: "a" }));
    const b = await post(req({ ...valid, level: 3, code: "b" }));
    expect([a.status, b.status]).toEqual([200, 402]);
    expect(model.calls).toBe(1);
  });

  it("C2: a hint that would take the balance below zero is refused with no model call (reserve first)", async () => {
    const credits = new InMemoryCredits({ u1: 2 });
    const { post, model } = setup({ credits });
    const res = await post(req({ ...valid, level: 4 })); // Scaffold costs 2
    expect(res.status).toBe(200);
    expect(credits.balances.get("u1")).toBe(0);
    const refused = await post(req({ ...valid, level: 4, code: "different" }));
    expect(refused.status).toBe(402);
    expect(model.calls).toBe(1);
  });

  it("C3: a model failure releases the reservation and ledger nets to zero", async () => {
    const credits = new InMemoryCredits({ u1: 3 });
    const { post } = setup({
      credits,
      model: fakeModel(() => {
        throw new Error("down");
      }),
    });
    const res = await post(req({ ...valid, level: 5 })); // Reveal costs 3
    expect(await res.json()).toMatchObject({ fallback: true, charged: false });
    expect(credits.balances.get("u1")).toBe(3);
    expect(credits.ledger.reduce((n, e) => n + e.delta, 0)).toBe(0);
    expect(credits.ledger.map((e) => e.reason)).toEqual(["hint_reserve", "hint_release"]);
  });

  it("C3: a release that fails once is retried so the learner is not charged", async () => {
    const credits = new InMemoryCredits({ u1: 3 });
    const realRelease = credits.release.bind(credits);
    let failures = 1;
    credits.release = async (u, c) => {
      if (failures-- > 0) throw new Error("db blip");
      return realRelease(u, c);
    };
    const { post } = setup({
      credits,
      model: fakeModel(() => {
        throw new Error("down");
      }),
    });
    await post(req({ ...valid, level: 3 }));
    expect(credits.balances.get("u1")).toBe(3);
  });

  it("C5: a free account is limited to levels 1-2", async () => {
    const accounts = new InMemoryAccounts({
      u1: { email: "u1@example.com", planKey: "free", balance: 0 },
    });
    const { post, model } = setup({ accounts, credits: new InMemoryCredits({ u1: 50 }) });
    expect((await post(req({ ...valid, level: 2 }))).status).toBe(200);
    expect((await post(req({ ...valid, level: 3 }))).status).toBe(403);
    expect((await post(req({ ...valid, level: 5 }))).status).toBe(403);
    expect(model.calls).toBe(1);
  });

  it("C5: an unknown account gets no paid levels", async () => {
    const { post } = setup({ accounts: new InMemoryAccounts() });
    expect((await post(req({ ...valid, level: 3 }))).status).toBe(403);
  });

  it("N3: the hint log stores the sha256 of the code, never the code", async () => {
    const hintLog = new InMemoryHintLog();
    const { post } = setup({ hintLog });
    await post(req({ ...valid, code: learnerCode }));
    expect(hintLog.entries).toHaveLength(1);
    const [entry] = hintLog.entries;
    expect(entry).toMatchObject({
      userId: "u1",
      exerciseId: exercise.id,
      level: 2,
      fallback: false,
    });
    expect(entry.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(entry)).not.toContain("LEARNER_SECRET_CODE");
    expect(Object.keys(entry).sort()).toEqual(
      ["codeHash", "exerciseId", "fallback", "level", "tokensIn", "tokensOut", "userId"].sort(),
    );
  });

  it("N3: application logs carry the hash and never the code", async () => {
    const logged: string[] = [];
    const spies = [
      vi.spyOn(console, "info").mockImplementation((m) => void logged.push(String(m))),
      vi.spyOn(console, "error").mockImplementation((m) => void logged.push(String(m))),
      vi.spyOn(console, "warn").mockImplementation((m) => void logged.push(String(m))),
    ];
    const { post } = setup({ requestHintDeps: { cache: new TtlCache() } }); // default logger
    await post(req({ ...valid, code: learnerCode }));
    spies.forEach((s) => s.mockRestore());
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join("\n")).not.toContain("LEARNER_SECRET_CODE");
  });

  it("N3: a failing hint log does not fail or un-charge the hint", async () => {
    const credits = new InMemoryCredits({ u1: 5 });
    const hintLog = {
      record: async () => {
        throw new Error("db down");
      },
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { post } = setup({ credits, hintLog });
    const res = await post(req({ ...valid, level: 3 }));
    errors.mockRestore();
    expect(res.status).toBe(200);
    expect(credits.balances.get("u1")).toBe(4);
  });

  it("N1: the old x-user-id header is not an identity", async () => {
    const { post, model } = setup();
    const res = await post(
      new Request("http://x/api/hint", {
        method: "POST",
        headers: { "x-user-id": "u1" },
        body: JSON.stringify(valid),
      }),
    );
    expect(res.status).toBe(401);
    expect(model.calls).toBe(0);
  });
});

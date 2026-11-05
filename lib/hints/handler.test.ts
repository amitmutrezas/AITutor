import { describe, expect, it, vi } from "vitest";
import {
  createHintHandler,
  createRateLimiter,
  headerAuth,
  noopCredits,
  type CreditsPort,
  type HandlerDeps,
} from "./handler";
import { createInMemoryExerciseStore, type LoadExercise } from "./exercise-store";
import { TtlCache } from "./service";
import { exercise, fakeModel, goodText } from "./test-fixtures";

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
    authenticate: headerAuth,
    rateLimiter: createRateLimiter(100),
    credits: noopCredits,
    requestHintDeps: { cache: new TtlCache(), log: () => undefined },
    ...over,
  };
  return { post: createHintHandler(deps), model, calls };
}

const req = (body: unknown, user: string | null = "u1") =>
  new Request("http://x/api/hint", {
    method: "POST",
    headers: { "content-type": "application/json", ...(user ? { "x-user-id": user } : {}) },
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
    const credits: CreditsPort = { canAfford: async () => false, charge: vi.fn() };
    const { post, model } = setup({ credits });
    const res = await post(req({ ...valid, level: 3 }));
    expect(res.status).toBe(402);
    expect(model.calls).toBe(0);
  });

  it("C2/H5: charges the level cost only for real hints, not fallbacks", async () => {
    const charge = vi.fn(async () => undefined);
    const credits: CreditsPort = { canAfford: async () => true, charge };
    const ok = setup({ credits });
    const res = await ok.post(req({ ...valid, level: 3 }));
    expect((await res.json()).charged).toBe(true);
    expect(charge).toHaveBeenCalledWith("u1", 1, { exerciseId: exercise.id, level: 3 });

    charge.mockClear();
    const failing = setup({
      credits,
      model: fakeModel(() => {
        throw new Error("down");
      }),
    });
    const res2 = await failing.post(req({ ...valid, level: 3 }));
    expect(await res2.json()).toMatchObject({ fallback: true, charged: false });
    expect(charge).not.toHaveBeenCalled();
  });
});

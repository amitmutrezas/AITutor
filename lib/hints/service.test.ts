import { afterEach, describe, expect, it, vi } from "vitest";
import { SAFE_GENERIC_HINT, TtlCache, hashCode, requestHint, type HintLogEvent } from "./service";
import {
  SECRET_MARKER,
  exercise,
  fakeModel,
  goodText,
  learnerCode,
  stripSolution,
} from "./test-fixtures";

const ex13 = stripSolution(exercise);
const base = () => ({ cache: new TtlCache(), log: () => undefined });
const ref = async () => exercise.referenceSolution;

afterEach(() => vi.restoreAllMocks());

describe("requestHint", () => {
  it("H5: leak trip returns the stored fallback, no charge", async () => {
    const model = fakeModel(() => ({
      text: exercise.referenceSolution,
      tokensIn: 5,
      tokensOut: 5,
    }));
    const r = await requestHint(
      { level: 2, exercise: ex13, learnerCode, model, getReferenceForLeakCheck: ref },
      base(),
    );
    expect(r).toMatchObject({ hint: "fb2", fallback: true, fallbackReason: "leak", charge: false });
  });

  it("H5: model error returns the fallback, no charge", async () => {
    const model = fakeModel(() => {
      throw new Error("boom");
    });
    const r = await requestHint(
      { level: 3, exercise: ex13, learnerCode, model, getReferenceForLeakCheck: ref },
      base(),
    );
    expect(r).toMatchObject({
      hint: "fb3",
      fallback: true,
      fallbackReason: "model-error",
      charge: false,
    });
  });

  it("H5: timeout returns the fallback, no charge", async () => {
    const model = fakeModel(() => new Promise(() => undefined));
    const r = await requestHint(
      { level: 1, exercise: ex13, learnerCode, model, getReferenceForLeakCheck: ref },
      { ...base(), timeoutMs: 20 },
    );
    expect(r).toMatchObject({
      hint: "fb1",
      fallback: true,
      fallbackReason: "timeout",
      charge: false,
    });
  });

  it("H5: missing reference for the leak check fails closed to the fallback", async () => {
    const model = fakeModel(() => ({ text: goodText, tokensIn: 1, tokensOut: 1 }));
    const r = await requestHint({ level: 1, exercise: ex13, learnerCode, model }, base());
    expect(r).toMatchObject({ fallback: true, charge: false });
  });

  it("H4: levels 1-4 run the leak check, good hints pass and are charged", async () => {
    const model = fakeModel(() => ({ text: goodText, tokensIn: 10, tokensOut: 20 }));
    const r = await requestHint(
      { level: 1, exercise: ex13, learnerCode, model, getReferenceForLeakCheck: ref },
      base(),
    );
    expect(r).toMatchObject({
      hint: goodText,
      fallback: false,
      charge: true,
      tokensIn: 10,
      tokensOut: 20,
    });
  });

  it("H4: level 4 uses the exercise's own solution for the check", async () => {
    const model = fakeModel(() => ({
      text: exercise.referenceSolution,
      tokensIn: 1,
      tokensOut: 1,
    }));
    const r = await requestHint({ level: 4, exercise, learnerCode, model }, base());
    expect(r).toMatchObject({ hint: "fb4", fallback: true });
  });

  it("H6: Reveal skips the leak check and may show the solution", async () => {
    const model = fakeModel(() => ({
      text: exercise.referenceSolution,
      tokensIn: 1,
      tokensOut: 1,
    }));
    const r = await requestHint({ level: 5, exercise, learnerCode, model }, base());
    expect(r).toMatchObject({ hint: exercise.referenceSolution, fallback: false, charge: true });
  });

  it("H7: same (exercise, level, code) is served from cache and not charged twice", async () => {
    const model = fakeModel(() => ({ text: goodText, tokensIn: 3, tokensOut: 4 }));
    const deps = base();
    const args = {
      level: 2 as const,
      exercise: ex13,
      learnerCode,
      model,
      getReferenceForLeakCheck: ref,
    };
    const first = await requestHint(args, deps);
    const second = await requestHint(args, deps);
    expect(model.calls).toBe(1);
    expect(second).toMatchObject({ hint: first.hint, cached: true, charge: false });
    await requestHint({ ...args, learnerCode: learnerCode + " " }, deps);
    expect(model.calls).toBe(2);
  });

  it("H7: cache entries expire after the TTL", async () => {
    let t = 0;
    const cache = new TtlCache(1000, () => t);
    const model = fakeModel(() => ({ text: goodText, tokensIn: 1, tokensOut: 1 }));
    const args = {
      level: 2 as const,
      exercise: ex13,
      learnerCode,
      model,
      getReferenceForLeakCheck: ref,
    };
    await requestHint(args, { cache, log: () => undefined });
    t = 1001;
    await requestHint(args, { cache, log: () => undefined });
    expect(model.calls).toBe(2);
  });

  it("H7: fallbacks are not cached", async () => {
    const model = fakeModel((n) =>
      n === 1
        ? { text: exercise.referenceSolution, tokensIn: 1, tokensOut: 1 }
        : { text: goodText, tokensIn: 1, tokensOut: 1 },
    );
    const deps = base();
    const args = {
      level: 2 as const,
      exercise: ex13,
      learnerCode,
      model,
      getReferenceForLeakCheck: ref,
    };
    expect((await requestHint(args, deps)).fallback).toBe(true);
    expect((await requestHint(args, deps)).fallback).toBe(false);
  });

  it("N2: logs token counts and N3: never logs learner code or the solution", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const model = fakeModel((n) => ({
      text: n === 1 ? goodText : exercise.referenceSolution,
      tokensIn: 7,
      tokensOut: 9,
    }));
    // default logger (console.info) on purpose
    await requestHint(
      { level: 2, exercise: ex13, learnerCode, model, getReferenceForLeakCheck: ref },
      { cache: new TtlCache() },
    );
    await requestHint(
      {
        level: 2,
        exercise: ex13,
        learnerCode: learnerCode + "x",
        model,
        getReferenceForLeakCheck: ref,
      },
      { cache: new TtlCache() },
    );
    const out = spies.flatMap((s) => s.mock.calls.flat()).join("\n");
    expect(out).toContain(hashCode(learnerCode));
    expect(out).toContain('"tokensIn":7');
    expect(out).not.toContain("LEARNER_SECRET_CODE");
    expect(out).not.toContain(SECRET_MARKER);
  });

  it("N3: log events carry a hash, not code", async () => {
    const events: HintLogEvent[] = [];
    const model = fakeModel(() => ({ text: goodText, tokensIn: 1, tokensOut: 1 }));
    await requestHint(
      { level: 1, exercise: ex13, learnerCode, model, getReferenceForLeakCheck: ref },
      { cache: new TtlCache(), log: (e) => events.push(e) },
    );
    expect(JSON.stringify(events)).not.toContain("LEARNER_SECRET_CODE");
    expect(events[0].codeHash).toBe(hashCode(learnerCode));
  });

  it("N2: a leak-rejected fallback keeps the real token counts", async () => {
    const model = fakeModel(() => ({
      text: exercise.referenceSolution,
      tokensIn: 11,
      tokensOut: 13,
    }));
    const r = await requestHint(
      { level: 2, exercise: ex13, learnerCode, model, getReferenceForLeakCheck: ref },
      base(),
    );
    expect(r).toMatchObject({ fallback: true, tokensIn: 11, tokensOut: 13 });
    const noRef = await requestHint(
      { level: 2, exercise: ex13, learnerCode: "other", model },
      base(),
    );
    expect(noRef).toMatchObject({ fallback: true, tokensIn: 11, tokensOut: 13 });
  });

  it("H7: concurrent identical requests make one model call and only one is chargeable", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const model = fakeModel(async () => {
      await gate;
      return { text: goodText, tokensIn: 1, tokensOut: 1 };
    });
    const deps = base();
    const args = {
      level: 2 as const,
      exercise: ex13,
      learnerCode,
      model,
      getReferenceForLeakCheck: ref,
    };
    const p1 = requestHint(args, deps);
    const p2 = requestHint(args, deps);
    release();
    const [a, b] = await Promise.all([p1, p2]);
    expect(model.calls).toBe(1);
    expect([a.charge, b.charge].sort()).toEqual([false, true]);
    expect(b.hint).toBe(a.hint);
  });

  it("H7: in-flight entry is removed on settle and fallbacks are not cached", async () => {
    const model = fakeModel((n) => {
      if (n === 1) throw new Error("x");
      return { text: goodText, tokensIn: 1, tokensOut: 1 };
    });
    const deps = base();
    const args = {
      level: 2 as const,
      exercise: ex13,
      learnerCode,
      model,
      getReferenceForLeakCheck: ref,
    };
    expect((await requestHint(args, deps)).fallback).toBe(true);
    expect((await requestHint(args, deps)).fallback).toBe(false);
    expect(model.calls).toBe(2);
  });

  it("H7: cache sweeps expired entries and caps its size, evicting the oldest", () => {
    let t = 0;
    const cache = new TtlCache(1000, () => t, 3);
    const v = { hint: "h" } as never;
    cache.set("a", v);
    cache.set("b", v);
    t = 1500;
    cache.set("c", v);
    expect(cache.size).toBe(1);
    cache.set("d", v);
    cache.set("e", v);
    cache.set("f", v);
    expect(cache.size).toBe(3);
    expect(cache.get("c")).toBeUndefined();
    expect(cache.get("f")).toBeDefined();
  });

  it("H5/POLICY 1.2: a stored fallback containing the solution never reaches the learner", async () => {
    const leakyEx = {
      ...ex13,
      fallbackHints: [1, 2, 3, 4, 5].map(
        () => exercise.referenceSolution,
      ) as typeof ex13.fallbackHints,
    };
    const failing = fakeModel(() => {
      throw new Error("down");
    });
    const leaking = fakeModel(() => ({
      text: exercise.referenceSolution,
      tokensIn: 1,
      tokensOut: 1,
    }));
    const hang = fakeModel(() => new Promise(() => undefined));
    for (const [model, deps] of [
      [failing, base()],
      [leaking, base()],
      [hang, { ...base(), timeoutMs: 10 }],
    ] as const) {
      const r = await requestHint(
        { level: 2, exercise: leakyEx, learnerCode, model, getReferenceForLeakCheck: ref },
        deps,
      );
      expect(r).toMatchObject({ hint: SAFE_GENERIC_HINT, fallback: true, charge: false });
    }
    // Level 4 uses the exercise's own solution for the check.
    const r4 = await requestHint(
      {
        level: 4,
        exercise: { ...exercise, fallbackHints: leakyEx.fallbackHints },
        learnerCode,
        model: failing,
      },
      base(),
    );
    expect(r4.hint).toBe(SAFE_GENERIC_HINT);
    // Fail closed when the reference loader throws.
    const r1 = await requestHint(
      {
        level: 1,
        exercise: leakyEx,
        learnerCode,
        model: failing,
        getReferenceForLeakCheck: async () => {
          throw new Error("db");
        },
      },
      base(),
    );
    expect(r1.hint).toBe(SAFE_GENERIC_HINT);
  });

  it("H6: level 5 fallback skips the leak check", async () => {
    const failing = fakeModel(() => {
      throw new Error("down");
    });
    const r = await requestHint({ level: 5, exercise, learnerCode, model: failing }, base());
    expect(r).toMatchObject({ hint: "fb5", fallback: true });
  });

  it("N2: log events carry the opaque userId but never code", async () => {
    const events: HintLogEvent[] = [];
    const model = fakeModel(() => ({ text: goodText, tokensIn: 1, tokensOut: 1 }));
    const args = {
      level: 1 as const,
      exercise: ex13,
      learnerCode,
      model,
      userId: "user-42",
      getReferenceForLeakCheck: ref,
    };
    const deps = { cache: new TtlCache(), log: (e: HintLogEvent) => events.push(e) };
    await requestHint(args, deps);
    await requestHint(args, deps);
    expect(events.map((e) => e.userId)).toEqual(["user-42", "user-42"]);
    expect(JSON.stringify(events)).not.toContain("LEARNER_SECRET_CODE");
  });

  it("N2: empty model output keeps the provider's token usage on the fallback and log", async () => {
    const events: HintLogEvent[] = [];
    const model = fakeModel(() => ({ text: "  ", tokensIn: 21, tokensOut: 0 }));
    const r = await requestHint(
      { level: 2, exercise: ex13, learnerCode, model, getReferenceForLeakCheck: ref },
      { cache: new TtlCache(), log: (e) => events.push(e) },
    );
    expect(r).toMatchObject({
      fallback: true,
      fallbackReason: "model-error",
      charge: false,
      tokensIn: 21,
    });
    expect(events[0]).toMatchObject({ tokensIn: 21, fallback: true });
  });

  it("H1: an over-cap hint at levels 1-4 falls back, uncharged, uncached, with real tokens", async () => {
    const long = Array.from({ length: 121 }, () => "word").join(" ");
    const model = fakeModel(() => ({ text: long, tokensIn: 30, tokensOut: 40 }));
    const deps = base();
    const args = {
      level: 2 as const,
      exercise: ex13,
      learnerCode,
      model,
      getReferenceForLeakCheck: ref,
    };
    const r = await requestHint(args, deps);
    expect(r).toMatchObject({
      hint: "fb2",
      fallback: true,
      fallbackReason: "too-long",
      charge: false,
      tokensIn: 30,
      tokensOut: 40,
    });
    await requestHint(args, deps);
    expect(model.calls).toBe(2);
    const exact = Array.from({ length: 120 }, () => "word").join(" ");
    const ok = fakeModel(() => ({ text: exact, tokensIn: 1, tokensOut: 1 }));
    expect((await requestHint({ ...args, model: ok }, base())).fallback).toBe(false);
  });

  it("H1: Reveal is exempt from the word cap", async () => {
    const long = Array.from({ length: 500 }, () => "word").join(" ");
    const model = fakeModel(() => ({ text: long, tokensIn: 1, tokensOut: 1 }));
    const r = await requestHint({ level: 5, exercise, learnerCode, model }, base());
    expect(r).toMatchObject({ hint: long, fallback: false, charge: true });
  });
});

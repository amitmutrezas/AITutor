import { afterEach, describe, expect, it, vi } from "vitest";
import { TtlCache, hashCode, requestHint, type HintLogEvent } from "./service";
import { SECRET_MARKER, exercise, fakeModel, goodText, learnerCode, stripSolution } from "./test-fixtures";

const ex13 = stripSolution(exercise);
const base = () => ({ cache: new TtlCache(), log: () => undefined });
const ref = async () => exercise.referenceSolution;

afterEach(() => vi.restoreAllMocks());

describe("requestHint", () => {
  it("H5: leak trip returns the stored fallback, no charge", async () => {
    const model = fakeModel(() => ({ text: exercise.referenceSolution, tokensIn: 5, tokensOut: 5 }));
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
    const r = await requestHint({ level: 3, exercise: ex13, learnerCode, model, getReferenceForLeakCheck: ref }, base());
    expect(r).toMatchObject({ hint: "fb3", fallback: true, fallbackReason: "model-error", charge: false });
  });

  it("H5: timeout returns the fallback, no charge", async () => {
    const model = fakeModel(() => new Promise(() => undefined));
    const r = await requestHint(
      { level: 1, exercise: ex13, learnerCode, model, getReferenceForLeakCheck: ref },
      { ...base(), timeoutMs: 20 },
    );
    expect(r).toMatchObject({ hint: "fb1", fallback: true, fallbackReason: "timeout", charge: false });
  });

  it("H5: missing reference for the leak check fails closed to the fallback", async () => {
    const model = fakeModel(() => ({ text: goodText, tokensIn: 1, tokensOut: 1 }));
    const r = await requestHint({ level: 1, exercise: ex13, learnerCode, model }, base());
    expect(r).toMatchObject({ fallback: true, charge: false });
  });

  it("H4: levels 1-4 run the leak check, good hints pass and are charged", async () => {
    const model = fakeModel(() => ({ text: goodText, tokensIn: 10, tokensOut: 20 }));
    const r = await requestHint({ level: 1, exercise: ex13, learnerCode, model, getReferenceForLeakCheck: ref }, base());
    expect(r).toMatchObject({ hint: goodText, fallback: false, charge: true, tokensIn: 10, tokensOut: 20 });
  });

  it("H4: level 4 uses the exercise's own solution for the check", async () => {
    const model = fakeModel(() => ({ text: exercise.referenceSolution, tokensIn: 1, tokensOut: 1 }));
    const r = await requestHint({ level: 4, exercise, learnerCode, model }, base());
    expect(r).toMatchObject({ hint: "fb4", fallback: true });
  });

  it("H6: Reveal skips the leak check and may show the solution", async () => {
    const model = fakeModel(() => ({ text: exercise.referenceSolution, tokensIn: 1, tokensOut: 1 }));
    const r = await requestHint({ level: 5, exercise, learnerCode, model }, base());
    expect(r).toMatchObject({ hint: exercise.referenceSolution, fallback: false, charge: true });
  });

  it("H7: same (exercise, level, code) is served from cache and not charged twice", async () => {
    const model = fakeModel(() => ({ text: goodText, tokensIn: 3, tokensOut: 4 }));
    const deps = base();
    const args = { level: 2 as const, exercise: ex13, learnerCode, model, getReferenceForLeakCheck: ref };
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
    const args = { level: 2 as const, exercise: ex13, learnerCode, model, getReferenceForLeakCheck: ref };
    await requestHint(args, { cache, log: () => undefined });
    t = 1001;
    await requestHint(args, { cache, log: () => undefined });
    expect(model.calls).toBe(2);
  });

  it("H7: fallbacks are not cached", async () => {
    const model = fakeModel((n) =>
      n === 1 ? { text: exercise.referenceSolution, tokensIn: 1, tokensOut: 1 } : { text: goodText, tokensIn: 1, tokensOut: 1 },
    );
    const deps = base();
    const args = { level: 2 as const, exercise: ex13, learnerCode, model, getReferenceForLeakCheck: ref };
    expect((await requestHint(args, deps)).fallback).toBe(true);
    expect((await requestHint(args, deps)).fallback).toBe(false);
  });

  it("N2: logs token counts and N3: never logs learner code or the solution", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const model = fakeModel((n) => ({ text: n === 1 ? goodText : exercise.referenceSolution, tokensIn: 7, tokensOut: 9 }));
    // default logger (console.info) on purpose
    await requestHint({ level: 2, exercise: ex13, learnerCode, model, getReferenceForLeakCheck: ref }, { cache: new TtlCache() });
    await requestHint({ level: 2, exercise: ex13, learnerCode: learnerCode + "x", model, getReferenceForLeakCheck: ref }, { cache: new TtlCache() });
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
});

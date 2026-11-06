import { describe, expect, it, vi } from "vitest";
import { handleReconcileCron } from "./cron";
import { InMemoryCredits } from "./memory";

const get = (auth?: string) =>
  new Request("http://x/api/cron/reconcile-credits", {
    headers: auth ? { authorization: auth } : {},
  });

describe("3.2: cron reconcile route", () => {
  it("3.2: no Authorization header is 401 and reconciles nothing", async () => {
    const credits = new InMemoryCredits();
    const spy = vi.spyOn(credits, "reconcile");
    expect((await handleReconcileCron(get(), { secret: "s3cret", credits })).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("3.2: a wrong secret is 401", async () => {
    const credits = new InMemoryCredits();
    const spy = vi.spyOn(credits, "reconcile");
    for (const bad of ["Bearer nope", "s3cret", "bearer s3cret", "Bearer "]) {
      expect((await handleReconcileCron(get(bad), { secret: "s3cret", credits })).status).toBe(401);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("3.2: fails closed when CRON_SECRET is not configured, even for a matching-looking header", async () => {
    const credits = new InMemoryCredits();
    for (const secret of [undefined, ""]) {
      for (const h of ["Bearer undefined", "Bearer ", "Bearer"]) {
        expect((await handleReconcileCron(get(h), { secret, credits })).status).toBe(401);
      }
    }
  });

  it("3.2: the right secret reconciles stale reservations and reports the count", async () => {
    let t = 0;
    const credits = new InMemoryCredits({ u1: 5 }, { now: () => t });
    await credits.reserve("u1", 2);
    t += 10 * 60_000;
    const res = await handleReconcileCron(get("Bearer s3cret"), { secret: "s3cret", credits });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ released: 1 });
    expect(await credits.balance("u1")).toBe(5);
    const again = await handleReconcileCron(get("Bearer s3cret"), { secret: "s3cret", credits });
    expect(await again.json()).toEqual({ released: 0 });
  });

  it("3.2: a database failure is a generic 500", async () => {
    const credits = new InMemoryCredits();
    credits.reconcile = async () => {
      throw new Error("SELECT secret FROM ...");
    };
    const res = await handleReconcileCron(get("Bearer s3cret"), { secret: "s3cret", credits });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("SELECT");
  });
});

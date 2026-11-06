import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static checks on the SQL (tests never call a database). The behaviour of these functions was
// also exercised against a throwaway Postgres when the migration was written; see the PR description.
const m1 = readFileSync(new URL("./migrations/0001_init.sql", import.meta.url), "utf8");
const m2 = readFileSync(
  new URL("./migrations/0002_accounts_credits_payments.sql", import.meta.url),
  "utf8",
);

describe("M5 migration 0002", () => {
  it("C3: every function is SECURITY DEFINER with a pinned search_path", () => {
    const fns = m2.match(/create function public\.\w+/g) ?? [];
    expect(fns.length).toBeGreaterThanOrEqual(15);
    const definers = m2.match(/security definer set search_path = public/g) ?? [];
    expect(definers.length).toBe(fns.length);
  });

  it("C2: reserve is one conditional UPDATE that cannot go below zero", () => {
    expect(m2).toMatch(/balance integer not null default 0 check \(balance >= 0\)/);
    expect(m2).toMatch(/where user_id = p_user and balance >= p_cost/);
  });

  it("3.2: reservations have ids and statuses and a service-role reconcile releases stale ones", () => {
    expect(m2).toMatch(/create table public\.credit_reservations/);
    expect(m2).toMatch(/status in \('reserved', 'settled', 'released', 'expired'\)/);
    expect(m2).toMatch(/create function public\.credits_reconcile/);
    expect(m2).toMatch(/_credits_release_locked\(c\.id, p_timeout_seconds\)/);
    expect(m2).toMatch(/'credits_reconcile', 'credits_settle_hint'/);
  });

  it("C3: settle writes the hint log and marks the reservation settled in one function", () => {
    const fn = m2.match(/create function public\.credits_settle_hint[\s\S]*?end \$\$;/)?.[0] ?? "";
    expect(fn).toMatch(/insert into public\.hint_log/);
    expect(fn).toMatch(/set status = 'settled'/);
  });

  it("C4: credits_reset expires open reservations in the same transaction, before touching the balance", () => {
    const fn = m2.match(/create function public\.credits_reset[\s\S]*?end \$\$;/)?.[0] ?? "";
    expect(fn).toMatch(/set status = 'expired'/);
    expect(fn.indexOf("_credits_lock_balance(")).toBeGreaterThan(-1);
    expect(fn.indexOf("_credits_lock_balance(")).toBeLessThan(fn.indexOf("set status = 'expired'"));
  });

  it("P1: a row with a Razorpay subscription is never closed locally by the claim; the caller must confirm", () => {
    const fn =
      m2.match(/create function public\.payments_claim_checkout[\s\S]*?end \$\$;/)?.[0] ?? "";
    expect(fn).toMatch(/'outcome', 'supersede'/);
    expect(m2).toMatch(/create function public\.payments_close_checkout/);
  });

  it("lock order: every credits function takes the balance lock before it locks or changes reservations", () => {
    const body = (name: string) =>
      m2.match(new RegExp(`create function public\\.${name}\\b[\\s\\S]*?end \\$\\$;`))?.[0] ?? "";
    for (const name of [
      "credits_reset",
      "credits_reserve",
      "credits_release",
      "credits_settle_hint",
      "credits_reconcile",
    ]) {
      const fn = body(name);
      const lock = fn.indexOf("_credits_lock_balance(");
      expect(lock, name).toBeGreaterThan(-1);
      const firstReservationWrite = [
        fn.indexOf("update public.credit_reservations"),
        fn.indexOf("insert into public.credit_reservations"),
        fn.indexOf("_credits_release_locked("),
        fn.search(/from public\.credit_reservations where id = p_reservation for update/),
      ].filter((i) => i >= 0);
      for (const i of firstReservationWrite) expect(lock, name).toBeLessThan(i);
    }
    // The release helper never takes the balance lock itself: its callers must already hold it.
    expect(body("_credits_release_locked")).not.toMatch(
      /for update;[\s\S]*credit_balances[\s\S]*for update/,
    );
  });

  it("lock order: reconcile visits candidates in a fixed order", () => {
    expect(m2).toMatch(/order by user_id, created_at, id/);
  });

  it("A3/P1: checkout claim and attach take the profile lock and refuse while deleting_at is recent", () => {
    for (const name of ["payments_claim_checkout", "payments_attach_subscription"]) {
      const fn =
        m2.match(new RegExp(`create function public\\.${name}\\b[\\s\\S]*?end \\$\\$;`))?.[0] ?? "";
      expect(fn, name).toMatch(/from public\.profiles where id = [\w]+ for update/);
      expect(fn, name).toContain("interval '10 minutes'");
    }
  });

  it("P1: attach returns a boolean (false when no row was updated)", () => {
    expect(m2).toMatch(
      /payments_attach_subscription\(p_claim uuid, p_razorpay_subscription_id text\) returns boolean/,
    );
  });

  it("A3/P1: begin rejects a second active deletion; cancel and delete are compare-and-set on the token", () => {
    const begin =
      m2.match(/create function public\.account_begin_delete[\s\S]*?end \$\$;/)?.[0] ?? "";
    expect(begin).toMatch(/in_progress/);
    expect(begin).toMatch(/interval '10 minutes'/);
    const cancel =
      m2.match(/create function public\.account_cancel_delete[\s\S]*?end \$\$;/)?.[0] ?? "";
    expect(cancel).toMatch(/deleting_token = p_token/);
    const del = m2.match(/create function public\.account_delete[\s\S]*?end \$\$;/)?.[0] ?? "";
    expect(del).toMatch(/is distinct from p_token/);
  });

  it("A3/P1: an expired deletion lease is fenced: claim/attach rotate the token, account_delete rejects a lapsed lease", () => {
    for (const name of ["payments_claim_checkout", "payments_attach_subscription"]) {
      const fn =
        m2.match(new RegExp(`create function public\\.${name}\\b[\\s\\S]*?end \\$\\$;`))?.[0] ?? "";
      expect(fn, name).toMatch(/set deleting_at = null, deleting_token = null/);
    }
    const del = m2.match(/create function public\.account_delete[\s\S]*?end \$\$;/)?.[0] ?? "";
    expect(del).toMatch(/deletion lease expired/);
  });

  it("A3: account_delete requires account_begin_delete and locks in the documented order", () => {
    const fn = m2.match(/create function public\.account_delete[\s\S]*?end \$\$;/)?.[0] ?? "";
    expect(fn).toMatch(/account_begin_delete must run first/);
    const order = [
      "from public.profiles",
      "from public.subscriptions",
      "from public.credit_balances",
      "from public.credit_reservations",
      "delete from auth.users",
    ].map((t) => fn.indexOf(t));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("P2: an unknown subscription is looked up before the event id is claimed", () => {
    const fn = m2.match(/create function public\.payments_apply_event[\s\S]*?end \$\$;/)?.[0] ?? "";
    const lookup = fn.indexOf("select * into v_row");
    const claim = fn.lastIndexOf("insert into public.payment_events");
    expect(lookup).toBeGreaterThan(0);
    expect(lookup).toBeLessThan(claim);
  });

  it("P2: processed webhook events are keyed by event id and the table is service-role only", () => {
    expect(m2).toMatch(/event_id text primary key/);
    expect(m2).toMatch(/on conflict \(event_id\) do nothing/);
    expect(m2).toMatch(/alter table public\.payment_events enable row level security/);
    expect(m2).toMatch(/revoke all on public\.payment_events from anon, authenticated/);
  });

  it("P1: at most one live subscription per learner", () => {
    expect(m2).toMatch(
      /unique index subscriptions_one_live_per_user[\s\S]*where status in \('pending', 'active', 'halted'\)/,
    );
  });

  it("N3: hint_log has no column that could hold learner code", () => {
    const table = m1.match(/create table public\.hint_log \(([\s\S]*?)\n\);/)?.[1] ?? "";
    expect(table).toContain("code_hash");
    expect(table).not.toMatch(/\bcode\s+text/);
    expect(m2).not.toMatch(/alter table public\.hint_log add column/);
  });

  it("A3: deleting an account cascades from auth.users to every learner-data table", () => {
    expect(m2).toMatch(/delete from auth\.users where id = p_user/);
    for (const table of ["saved_code", "hint_log", "credit_ledger", "subscriptions"]) {
      expect(m1).toMatch(
        new RegExp(
          `create table public\\.${table} \\([\\s\\S]*?references public\\.profiles \\(id\\) on delete cascade`,
        ),
      );
    }
    expect(m2).toMatch(
      /credit_balances \([\s\S]*references public\.profiles \(id\) on delete cascade/,
    );
  });

  it("N1: functions are revoked from anon and authenticated and granted to the service role only", () => {
    expect(m2).toMatch(/revoke all on function %s from public, anon, authenticated/);
    expect(m2).toMatch(/grant execute on function %s to service_role/);
    for (const fn of [
      "credits_reserve",
      "credits_release",
      "payments_apply_event",
      "saved_code_delete_all",
      "account_delete",
    ]) {
      expect(m2).toContain(`'${fn}'`);
    }
  });

  it("does not rewrite 0001: it only adds", () => {
    expect(m2).not.toMatch(/drop table/i);
  });
});

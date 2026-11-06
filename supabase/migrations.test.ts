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

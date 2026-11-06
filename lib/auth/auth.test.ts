import { describe, expect, it } from "vitest";
import {
  credentialsBody,
  handleSignIn,
  handleSignOut,
  handleSignUp,
  type AuthProvider,
} from "./credentials";
import { requireUser } from "./session";
import { createSupabaseAuthProvider } from "./supabase-provider";

const post = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body) });

function provider(over: Partial<AuthProvider> = {}): AuthProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async signUp(email, _pw, redirect) {
      calls.push(`signUp:${email}:${redirect}`);
      return "confirm_email";
    },
    async signIn(email) {
      calls.push(`signIn:${email}`);
      return true;
    },
    async signOut() {
      calls.push("signOut");
    },
    ...over,
  };
}

describe("A1: session auth helper", () => {
  it("A1: requireUser returns 401 when no verified session exists", async () => {
    const r = await requireUser(new Request("http://x/"), async () => null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(401);
      expect(await r.response.json()).toEqual({ error: "Sign in required" });
    }
  });

  it("A1: requireUser fails closed if the authenticator throws", async () => {
    const r = await requireUser(new Request("http://x/"), async () => {
      throw new Error("auth outage");
    });
    expect(r.ok).toBe(false);
  });

  it("A1: requireUser passes the verified user through", async () => {
    const r = await requireUser(new Request("http://x/"), async () => ({
      id: "u1",
      email: "a@b.co",
    }));
    expect(r).toMatchObject({ ok: true, user: { id: "u1" } });
  });

  it("A1: identity comes only from the authenticator, never from request headers", async () => {
    const req = new Request("http://x/", { headers: { "x-user-id": "attacker" } });
    const r = await requireUser(req, async () => null);
    expect(r.ok).toBe(false);
  });
});

describe("A1: email sign-up and sign-in", () => {
  it("A1: credentials are validated by Zod: bad email, short password and unknown fields are rejected", () => {
    expect(credentialsBody.safeParse({ email: "a@b.co", password: "12345678" }).success).toBe(true);
    expect(credentialsBody.safeParse({ email: "nope", password: "12345678" }).success).toBe(false);
    expect(credentialsBody.safeParse({ email: "a@b.co", password: "short" }).success).toBe(false);
    expect(
      credentialsBody.safeParse({ email: "a@b.co", password: "12345678", admin: true }).success,
    ).toBe(false);
    expect(credentialsBody.safeParse({ email: "a@b.co", password: "x".repeat(73) }).success).toBe(
      false,
    );
  });

  it("A1: email is trimmed and lower-cased", () => {
    const r = credentialsBody.parse({ email: "  A@B.Co ", password: "12345678" });
    expect(r.email).toBe("a@b.co");
  });

  it("A1: sign-up with invalid input is 400 and never calls the provider", async () => {
    const p = provider();
    expect((await handleSignUp(post("/api/auth/signup", { email: "x" }), p)).status).toBe(400);
    expect(p.calls).toEqual([]);
  });

  it("A1: sign-up asks for email confirmation and passes a same-origin redirect", async () => {
    const p = provider();
    const res = await handleSignUp(
      post("/api/auth/signup", { email: "a@b.co", password: "12345678" }),
      p,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "confirm_email" });
    expect(p.calls).toEqual(["signUp:a@b.co:http://localhost/auth/confirm"]);
  });

  it("A1: sign-in failure is one generic 401 that does not say which part was wrong", async () => {
    const p = provider({ signIn: async () => false });
    const res = await handleSignIn(
      post("/api/auth/signin", { email: "a@b.co", password: "12345678" }),
      p,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Email or password is not right" });
  });

  it("A1: sign-in success and sign-out", async () => {
    const p = provider();
    const ok = await handleSignIn(
      post("/api/auth/signin", { email: "a@b.co", password: "12345678" }),
      p,
    );
    expect(ok.status).toBe(200);
    expect((await handleSignOut(p)).status).toBe(200);
    expect(p.calls).toEqual(["signIn:a@b.co", "signOut"]);
  });

  it("A1: a provider crash is a generic 500 with no details", async () => {
    const p = provider({
      signIn: async () => {
        throw new Error("secret stack detail");
      },
    });
    const res = await handleSignIn(
      post("/api/auth/signin", { email: "a@b.co", password: "12345678" }),
      p,
    );
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});

describe("A1: Supabase provider sign-out", () => {
  const store = { getAll: () => [], set: () => undefined };
  const fake = (signOut: () => Promise<{ error: unknown }>) =>
    ({
      auth: { signUp: async () => ({}), signInWithPassword: async () => ({}), signOut },
    }) as unknown as Parameters<typeof createSupabaseAuthProvider>[1];

  it("A1: a signOut that resolves with { error } makes the handler fail, not return 200", async () => {
    const p = createSupabaseAuthProvider(
      store,
      fake(async () => ({ error: { message: "x" } })),
    );
    const res = await handleSignOut(p!);
    expect(res.status).toBe(500);
    expect(await res.json()).not.toHaveProperty("status", "signed_out");
  });

  it("A1: a clean signOut is 200", async () => {
    const p = createSupabaseAuthProvider(
      store,
      fake(async () => ({ error: null })),
    );
    expect((await handleSignOut(p!)).status).toBe(200);
  });
});

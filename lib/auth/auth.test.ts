import { describe, expect, it } from "vitest";
import {
  handleSendCode,
  handleSignOut,
  handleVerifyCode,
  sendCodeBody,
  verifyCodeBody,
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
    async sendCode(email, redirect) {
      calls.push(`send:${email}:${redirect}`);
      return "sent";
    },
    async verifyCode(email, token) {
      calls.push(`verify:${email}:${token}`);
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

describe("A1: email code sign-in and account creation", () => {
  it("A1: bodies are validated by Zod: bad email, bad code and unknown fields are rejected", () => {
    expect(sendCodeBody.safeParse({ email: "a@b.co" }).success).toBe(true);
    expect(sendCodeBody.safeParse({ email: "nope" }).success).toBe(false);
    expect(sendCodeBody.safeParse({ email: "a@b.co", admin: true }).success).toBe(false);
    expect(verifyCodeBody.safeParse({ email: "a@b.co", token: "123456" }).success).toBe(true);
    expect(verifyCodeBody.safeParse({ email: "a@b.co", token: "12ab56" }).success).toBe(false);
    expect(verifyCodeBody.safeParse({ email: "a@b.co", token: "123" }).success).toBe(false);
  });

  it("A1: email is trimmed and lower-cased", () => {
    expect(sendCodeBody.parse({ email: "  A@B.Co " }).email).toBe("a@b.co");
  });

  it("A1: invalid input is 400 and never calls the provider", async () => {
    const p = provider();
    expect((await handleSendCode(post("/api/auth/otp/send", { email: "x" }), p)).status).toBe(400);
    expect(
      (await handleVerifyCode(post("/api/auth/otp/verify", { email: "a@b.co", token: "1" }), p))
        .status,
    ).toBe(400);
    expect(p.calls).toEqual([]);
  });

  it("A1: sending a code answers the same for any email and passes a same-origin redirect", async () => {
    const p = provider();
    const res = await handleSendCode(post("/api/auth/otp/send", { email: "a@b.co" }), p);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "sent" });
    expect(p.calls).toEqual(["send:a@b.co:http://localhost/auth/confirm"]);
  });

  it("A1: too many code requests is a 429", async () => {
    const p = provider({ sendCode: async () => "rate_limited" });
    expect((await handleSendCode(post("/api/auth/otp/send", { email: "a@b.co" }), p)).status).toBe(
      429,
    );
  });

  it("A1: a wrong or expired code is one generic 401", async () => {
    const p = provider({ verifyCode: async () => false });
    const res = await handleVerifyCode(
      post("/api/auth/otp/verify", { email: "a@b.co", token: "123456" }),
      p,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "That code is not right or has expired" });
  });

  it("A1: a right code signs in, and sign-out works", async () => {
    const p = provider();
    const ok = await handleVerifyCode(
      post("/api/auth/otp/verify", { email: "a@b.co", token: "123456" }),
      p,
    );
    expect(ok.status).toBe(200);
    expect((await handleSignOut(p)).status).toBe(200);
    expect(p.calls).toEqual(["verify:a@b.co:123456", "signOut"]);
  });

  it("A1: a provider crash is a generic 500 with no details", async () => {
    const p = provider({
      verifyCode: async () => {
        throw new Error("secret stack detail");
      },
    });
    const res = await handleVerifyCode(
      post("/api/auth/otp/verify", { email: "a@b.co", token: "123456" }),
      p,
    );
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});

describe("A1: Supabase provider", () => {
  const store = { getAll: () => [], set: () => undefined };
  const fake = (over: Record<string, unknown>) =>
    ({
      auth: {
        signInWithOtp: async () => ({}),
        verifyOtp: async () => ({}),
        signOut: async () => ({}),
        ...over,
      },
    }) as unknown as Parameters<typeof createSupabaseAuthProvider>[1];

  it("A1: sendCode creates the account when the email is new (shouldCreateUser)", async () => {
    let seen: unknown;
    const p = createSupabaseAuthProvider(
      store,
      fake({
        signInWithOtp: async (args: unknown) => {
          seen = args;
          return { error: null };
        },
      }),
    );
    expect(await p!.sendCode("a@b.co", "http://x/auth/confirm")).toBe("sent");
    expect(seen).toMatchObject({ email: "a@b.co", options: { shouldCreateUser: true } });
  });

  it("A1: sendCode maps a 429 to rate_limited and other errors to error", async () => {
    const mk = (status: number) =>
      createSupabaseAuthProvider(
        store,
        fake({ signInWithOtp: async () => ({ error: { status } }) }),
      )!;
    expect(await mk(429).sendCode("a@b.co", "u")).toBe("rate_limited");
    expect(await mk(500).sendCode("a@b.co", "u")).toBe("error");
  });

  it("A1: verifyCode is true only when a session comes back", async () => {
    const ok = createSupabaseAuthProvider(
      store,
      fake({ verifyOtp: async () => ({ data: { session: { x: 1 } }, error: null }) }),
    )!;
    const bad = createSupabaseAuthProvider(
      store,
      fake({ verifyOtp: async () => ({ data: { session: null }, error: { message: "x" } }) }),
    )!;
    expect(await ok.verifyCode("a@b.co", "123456")).toBe(true);
    expect(await bad.verifyCode("a@b.co", "123456")).toBe(false);
  });

  it("A1: a signOut that resolves with { error } makes the handler fail, not return 200", async () => {
    const p = createSupabaseAuthProvider(
      store,
      fake({ signOut: async () => ({ error: { message: "x" } }) }),
    );
    const res = await handleSignOut(p!);
    expect(res.status).toBe(500);
    expect(await res.json()).not.toHaveProperty("status", "signed_out");
  });

  it("A1: a clean signOut is 200", async () => {
    const p = createSupabaseAuthProvider(store, fake({ signOut: async () => ({ error: null }) }));
    expect((await handleSignOut(p!)).status).toBe(200);
  });
});

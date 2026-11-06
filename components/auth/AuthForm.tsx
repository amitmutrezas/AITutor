"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";

type Mode = "signin" | "signup";

const COPY: Record<
  Mode,
  { title: string; button: string; busy: string; other: string; href: string }
> = {
  signin: {
    title: "Sign in",
    button: "Sign in",
    busy: "Signing in...",
    other: "New here? Create an account",
    href: "/signup",
  },
  signup: {
    title: "Create your account",
    button: "Create account",
    busy: "Creating account...",
    other: "Already have an account? Sign in",
    href: "/signin",
  },
};

export function AuthForm({ mode, notice }: { mode: Mode; notice?: string }) {
  const copy = COPY[mode];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Could not reach the server. Please try again.");
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { status?: string };
      if (mode === "signup" && body.status === "confirm_email") return setConfirmEmail(true);
      return window.location.assign("/account");
    }
    if (res.status === 401) return setError("Email or password is not right.");
    if (res.status === 400) {
      return setError(
        mode === "signup"
          ? "Could not create the account. Use a valid email and a password of 8 to 72 characters."
          : "Enter a valid email and your password.",
      );
    }
    setError("Something went wrong. Please try again in a moment.");
  }

  if (confirmEmail) {
    return (
      <div className="card ok" role="status">
        <h1>Check your email</h1>
        <p>We sent you a link to confirm your address. After you confirm, you are signed in.</p>
      </div>
    );
  }

  return (
    <>
      <h1>{copy.title}</h1>
      {notice ? (
        <p className="card bad" role="alert">
          {notice}
        </p>
      ) : null}
      <form onSubmit={submit} noValidate={false}>
        <p>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            className="field"
            autoComplete="email"
            required
            maxLength={254}
          />
        </p>
        <p>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            className="field"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            minLength={8}
            maxLength={72}
            aria-describedby={mode === "signup" ? "password-help" : undefined}
          />
          {mode === "signup" ? (
            <span id="password-help" className="crumb">
              At least 8 characters.
            </span>
          ) : null}
        </p>
        <div role="alert" aria-live="assertive">
          {error ? <p className="card bad">{error}</p> : null}
        </div>
        <button type="submit" className="btn" disabled={busy}>
          {busy ? copy.busy : copy.button}
        </button>
      </form>
      <p>
        <Link href={copy.href}>{copy.other}</Link>
      </p>
    </>
  );
}

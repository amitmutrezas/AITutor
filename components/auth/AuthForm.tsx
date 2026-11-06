"use client";
import { useState, type FormEvent } from "react";

/**
 * One screen for signing in and creating an account: email, then the code we email. An email that
 * already has an account signs in; a new one gets an account. `next` is already sanitised on the
 * server (safeNextPath): a same-site path only.
 */
export function AuthForm({ notice, next }: { notice?: string; next?: string }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function post(path: string, body: unknown): Promise<Response | null> {
    return fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
  }

  async function sendCode(address: string) {
    setBusy(true);
    setError(null);
    setInfo(null);
    const res = await post("/api/auth/otp/send", { email: address });
    setBusy(false);
    if (!res) return setError("Could not reach the server. Please try again.");
    if (res.ok) {
      setEmail(address);
      setStep("code");
      return setInfo(`We emailed a code to ${address}.`);
    }
    if (res.status === 429)
      return setError("Too many codes requested. Wait a minute and try again.");
    if (res.status === 400) return setError("Enter a valid email address.");
    setError("Something went wrong. Please try again in a moment.");
  }

  function submitEmail(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    void sendCode(String(form.get("email") ?? "").trim());
  }

  async function submitCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await post("/api/auth/otp/verify", {
      email,
      token: String(form.get("code") ?? "").trim(),
    });
    setBusy(false);
    if (!res) return setError("Could not reach the server. Please try again.");
    if (res.ok) return window.location.assign(next ?? "/account");
    if (res.status === 401 || res.status === 400) {
      return setError("That code is not right or has expired. Check it, or send a new one.");
    }
    setError("Something went wrong. Please try again in a moment.");
  }

  return (
    <>
      <h1>Sign in or create account</h1>
      {notice ? (
        <p className="card bad" role="alert">
          {notice}
        </p>
      ) : null}
      {step === "email" ? (
        <>
          <p>
            <a
              className="btn"
              href={`/api/auth/google${next ? `?next=${encodeURIComponent(next)}` : ""}`}
            >
              Continue with Google
            </a>
          </p>
          <p>or use your email</p>
          <form onSubmit={submitEmail}>
            <p>
              Enter your email. We send you a code, no password needed. New here? That creates your
              account.
            </p>
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
            <div role="alert" aria-live="assertive">
              {error ? <p className="card bad">{error}</p> : null}
            </div>
            <button type="submit" className="btn" disabled={busy}>
              {busy ? "Sending code..." : "Send me a code"}
            </button>
          </form>
        </>
      ) : (
        <form onSubmit={submitCode}>
          <div role="status" aria-live="polite">
            {info ? <p className="card ok">{info}</p> : null}
          </div>
          <p>
            <label htmlFor="code">Code from your email</label>
            <input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="field"
              autoComplete="one-time-code"
              required
              minLength={6}
              maxLength={10}
            />
          </p>
          <div role="alert" aria-live="assertive">
            {error ? <p className="card bad">{error}</p> : null}
          </div>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? "Checking..." : "Continue"}
          </button>
          <p>
            <button
              type="button"
              className="linklike"
              disabled={busy}
              onClick={() => void sendCode(email)}
            >
              Send a new code
            </button>
            {" · "}
            <button
              type="button"
              className="linklike"
              disabled={busy}
              onClick={() => {
                setStep("email");
                setError(null);
                setInfo(null);
              }}
            >
              Use a different email
            </button>
          </p>
        </form>
      )}
    </>
  );
}

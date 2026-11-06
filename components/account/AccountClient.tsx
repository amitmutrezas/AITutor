"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface AccountData {
  email: string;
  plan: { id: string; name: string; monthlyCredits: number };
  credits: number;
}
interface SavedItem {
  exerciseId: string;
  code: string;
  updatedAt: string;
}
type Load = "loading" | "signedout" | "error" | "ready";

const DELETE_PHRASE = "delete my account";

export function AccountClient() {
  const [load, setLoad] = useState<Load>("loading");
  const [account, setAccount] = useState<AccountData | null>(null);
  const [items, setItems] = useState<SavedItem[]>([]);
  const [message, setMessage] = useState("");
  const [phrase, setPhrase] = useState("");

  const refresh = useCallback(async () => {
    const [a, s] = await Promise.all([
      fetch("/api/account").catch(() => null),
      fetch("/api/saved-code").catch(() => null),
    ]);
    if (a?.status === 401 || s?.status === 401) return setLoad("signedout");
    if (!a?.ok || !s?.ok) return setLoad("error");
    setAccount((await a.json()) as AccountData);
    setItems(((await s.json()) as { items: SavedItem[] }).items);
    setLoad("ready");
  }, []);

  useEffect(() => {
    // Fetching on mount is the point of this effect; state is set after the awaited responses.
    void refresh();
  }, [refresh]);

  async function remove(query: string, done: string) {
    const res = await fetch(`/api/saved-code?${query}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return setMessage("Could not delete. Please try again.");
    setMessage(done);
    await refresh();
  }

  async function signOut() {
    const res = await fetch("/api/auth/signout", { method: "POST" }).catch(() => null);
    if (!res?.ok) return setMessage("Could not sign out. Please try again.");
    window.location.assign("/signin");
  }

  async function deleteAccount() {
    const res = await fetch("/api/account", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: DELETE_PHRASE }),
    }).catch(() => null);
    if (res?.ok) {
      const out = await fetch("/api/auth/signout", { method: "POST" }).catch(() => null);
      if (!out?.ok) {
        return setMessage(
          "Your account was deleted, but we could not sign you out. Please close this browser window.",
        );
      }
      return window.location.assign("/");
    }
    setMessage(
      res?.status === 502
        ? "We could not cancel your subscription, so your account was not deleted. Please try again."
        : "Could not delete the account. Please try again.",
    );
  }

  if (load === "loading") return <p role="status">Loading your account...</p>;
  if (load === "signedout") {
    return (
      <>
        <h1>Your account</h1>
        <p>
          Please <Link href="/signin">sign in</Link> or{" "}
          <Link href="/signup">create an account</Link> to see your plan, credits and saved code.
        </p>
      </>
    );
  }
  if (load === "error" || !account) {
    return (
      <p role="alert" className="card bad">
        Could not load your account. Please refresh the page.
      </p>
    );
  }

  return (
    <>
      <h1>Your account</h1>
      <div role="status" aria-live="polite">
        {message ? <p className="card ok">{message}</p> : null}
      </div>

      <section className="card" aria-labelledby="plan-h">
        <h2 id="plan-h">Plan and credits</h2>
        <dl>
          <dt>Email</dt>
          <dd>{account.email}</dd>
          <dt>Plan</dt>
          <dd>{account.plan.name}</dd>
          <dt>Credits left</dt>
          <dd data-testid="credits">{account.credits}</dd>
        </dl>
        <p>
          <Link href="/plans">See plans</Link>
        </p>
      </section>

      <section className="card" aria-labelledby="code-h">
        <h2 id="code-h">Saved code</h2>
        <p className="crumb">
          We keep the latest code you ran for each exercise. You can delete it any time.
        </p>
        {items.length === 0 ? (
          <p>Nothing saved yet. Run an exercise to save your code.</p>
        ) : (
          <>
            <ul className="saved-list">
              {items.map((it) => (
                <li key={it.exerciseId}>
                  <div className="ex-row">
                    <span>
                      <strong>{it.exerciseId}</strong>{" "}
                      <span className="crumb">saved {new Date(it.updatedAt).toLocaleString()}</span>
                    </span>
                    <button
                      type="button"
                      className="btn secondary"
                      aria-label={`Delete saved code for ${it.exerciseId}`}
                      onClick={() =>
                        remove(
                          `exerciseId=${encodeURIComponent(it.exerciseId)}`,
                          `Deleted saved code for ${it.exerciseId}.`,
                        )
                      }
                    >
                      Delete
                    </button>
                  </div>
                  <details>
                    <summary>Show code</summary>
                    <pre className="code-view">{it.code}</pre>
                  </details>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn secondary"
              onClick={() => remove("all=true", "Deleted all saved code.")}
            >
              Delete all saved code
            </button>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="acct-h">
        <h2 id="acct-h">Account</h2>
        <button type="button" className="btn secondary" onClick={signOut}>
          Sign out
        </button>
        <h3>Delete account</h3>
        <p>
          This removes your account, saved code, hint history and credits. An active subscription is
          cancelled first. It cannot be undone.
        </p>
        <label htmlFor="confirm-delete">
          Type <q>{DELETE_PHRASE}</q> to confirm
        </label>
        <input
          id="confirm-delete"
          className="field"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          autoComplete="off"
        />
        <button
          type="button"
          className="btn danger"
          disabled={phrase !== DELETE_PHRASE}
          onClick={deleteAccount}
        >
          Delete my account
        </button>
      </section>
    </>
  );
}

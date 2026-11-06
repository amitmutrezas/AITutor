"use client";

import Link from "next/link";
import { useState } from "react";

interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", cb: () => void): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

type State = "default" | "starting" | "pending" | "confirm" | "confirming" | "done";

function loadCheckoutScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

const fail = (reason: string) => {
  window.location.assign(`/plans?error=${reason}`);
};

/** Signed out: go to a real sign-in page and come back to this checkout afterwards. */
const needSignIn = (planId: string) => {
  const back = `/checkout?plan=${encodeURIComponent(planId)}`;
  window.location.assign(`/signin?next=${encodeURIComponent(back)}`);
};

export function CheckoutClient({
  planId,
  planName,
  priceText,
  mode = "razorpay",
  monthlyCredits,
}: {
  planId: string;
  planName: string;
  priceText: string;
  mode?: "razorpay" | "mock";
  monthlyCredits?: number;
}) {
  const [state, setState] = useState<State>("default");
  const [mockError, setMockError] = useState<string | null>(null);

  async function pay() {
    setState("starting");
    const res = await fetch("/api/razorpay/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId }),
    }).catch(() => null);
    if (!res) return fail("unavailable");
    if (res.status === 401) return needSignIn(planId);
    if (!res.ok) return fail("unavailable");
    const { subscriptionId, keyId } = (await res.json()) as {
      subscriptionId: string;
      keyId: string;
    };
    if (!(await loadCheckoutScript()) || !window.Razorpay) return fail("unavailable");

    const rzp = new window.Razorpay({
      key: keyId,
      subscription_id: subscriptionId,
      name: "Unstuck",
      // P1: the success callback only shows a waiting message. The plan changes when the
      // server receives the verified webhook, never because of this callback.
      handler: () => setState("done"),
      modal: { ondismiss: () => fail("cancelled") },
    });
    rzp.on("payment.failed", () => fail("payment_failed"));
    setState("pending");
    rzp.open();
  }

  async function startMock() {
    setState("starting");
    const res = await fetch("/api/payments/mock/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId }),
    }).catch(() => null);
    if (!res) return fail("unavailable");
    if (res.status === 401) return needSignIn(planId);
    if (res.status === 409) {
      const b = (await res.json().catch(() => null)) as { error?: string } | null;
      setMockError(b?.error ?? "Checkout is not available right now.");
      return setState("default");
    }
    if (!res.ok) return fail("unavailable");
    setState("confirm");
  }

  async function confirmMock() {
    setState("confirming");
    const res = await fetch("/api/payments/mock/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId }),
    }).catch(() => null);
    if (!res) return fail("unavailable");
    if (res.status === 401) return needSignIn(planId);
    if (!res.ok) return fail("unavailable");
    setState("done");
  }

  if (mode === "mock") {
    if (state === "done") {
      return (
        <div role="status" className="card ok">
          <h1>Test plan applied</h1>
          <p>
            Test mode, no real payment was taken. Your {planName} plan
            {monthlyCredits === undefined ? "" : ` and ${monthlyCredits} credits`} are now on your
            account.
          </p>
          <p>
            <Link href="/account">See my account</Link> ·{" "}
            <Link href="/exercises">Back to exercises</Link>
          </p>
        </div>
      );
    }
    return (
      <div>
        <h1>Confirm your plan</h1>
        <p className="card bad" data-testid="mock-label">
          <strong>Test mode, no real payment.</strong> Nothing is charged and no card is used.
        </p>
        <p>
          {planName} plan, billed monthly: <strong>{priceText}</strong>
        </p>
        {mockError ? (
          <p role="alert" className="card bad">
            {mockError}
          </p>
        ) : null}
        {state === "confirm" || state === "confirming" ? (
          <>
            <p>
              Confirm to apply the {planName} plan
              {monthlyCredits === undefined ? "" : ` and ${monthlyCredits} credits`} to your
              account, as a successful payment would.
            </p>
            <button
              type="button"
              className="btn"
              onClick={confirmMock}
              disabled={state === "confirming"}
            >
              {state === "confirming" ? "Applying..." : "Confirm test payment"}
            </button>{" "}
            <Link href="/plans?error=cancelled">Cancel</Link>
          </>
        ) : (
          <button type="button" className="btn" onClick={startMock} disabled={state !== "default"}>
            Continue in test mode
          </button>
        )}
        <PolicyNote />
      </div>
    );
  }

  if (state === "done") {
    return (
      <div role="status">
        <h2>Payment received</h2>
        <p>
          Thank you. Your {planName} plan and credits appear as soon as the payment is confirmed,
          usually within a minute. Refresh to check.
        </p>
        <Link href="/">Back to my exercise</Link>
      </div>
    );
  }

  return (
    <div>
      <h1>Confirm your plan</h1>
      <p>
        {planName} plan, billed monthly: <strong>{priceText}</strong>
      </p>
      <p>You will pay on Razorpay&apos;s secure page.</p>
      {state === "pending" ? (
        <p role="status">
          Waiting for your bank to confirm. Please do not close this page or pay again.
        </p>
      ) : null}
      <button type="button" onClick={pay} disabled={state !== "default"}>
        Pay with Razorpay
      </button>
      <PolicyNote />
    </div>
  );
}

// The policy pages are not published yet (Amit supplies them), so no dead links.
function PolicyNote() {
  return (
    <p>
      <small>Terms (coming soon) and Refund policy (coming soon) will apply to paid plans.</small>
    </p>
  );
}

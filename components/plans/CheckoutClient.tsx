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

type State = "default" | "starting" | "pending" | "done";

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

export function CheckoutClient({
  planId,
  planName,
  priceText,
}: {
  planId: string;
  planName: string;
  priceText: string;
}) {
  const [state, setState] = useState<State>("default");

  async function pay() {
    setState("starting");
    const res = await fetch("/api/razorpay/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId }),
    }).catch(() => null);
    if (!res) return fail("unavailable");
    if (res.status === 401) return fail("signin");
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
      <p>
        <small>
          By paying you agree to the <a href="/terms">Terms</a> and{" "}
          <a href="/refund">Refund policy</a>.
        </small>
      </p>
    </div>
  );
}

"use client";
import Link from "next/link";
import { useState } from "react";
import { CREDIT_COST_BY_LEVEL, HINT_LEVELS } from "../../lib/config";

interface HintView {
  level: number;
  text: string;
  fallback: boolean;
  charged: boolean;
}

/**
 * Hint ladder (H1): the learner picks a level; nothing escalates by itself. The server decides
 * credits and plan limits (C2, C5); this panel only shows the cost and the result. Learner code is
 * sent to /api/hint and is not logged or stored here (N3).
 */
export function HintLadder({
  exerciseId,
  getCode,
  onHint,
}: {
  exerciseId: string;
  getCode: () => string;
  /** Called once per hint actually delivered, so the complete screen can show the real count. */
  onHint: () => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [hint, setHint] = useState<HintView | null>(null);
  const [problem, setProblem] = useState<{
    text: string;
    link?: { href: string; label: string };
  } | null>(null);

  async function ask(level: number) {
    setBusy(level);
    setProblem(null);
    const res = await fetch("/api/hint", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exerciseId, level, code: getCode() }),
    }).catch(() => null);
    setBusy(null);
    if (!res) return setProblem({ text: "Could not reach the server. Please try again." });
    if (res.status === 401) {
      return setProblem({
        text: "Sign in to ask for hints.",
        link: {
          href: `/signin?next=${encodeURIComponent(`/exercises/${exerciseId}`)}`,
          label: "Sign in",
        },
      });
    }
    if (res.status === 402) {
      return setProblem({
        text: "You do not have enough credits for that level. Nothing was charged.",
        link: { href: "/plans", label: "See plans" },
      });
    }
    if (res.status === 403) {
      return setProblem({
        text: "Your plan does not include that level.",
        link: { href: "/plans", label: "See plans" },
      });
    }
    if (res.status === 429) {
      return setProblem({ text: "Too many requests. Wait a moment and try again." });
    }
    if (!res.ok) {
      return setProblem({ text: "No hint this time, and nothing was charged. Please try again." });
    }
    const body = (await res.json().catch(() => null)) as {
      hint?: string;
      level?: number;
      fallback?: boolean;
      charged?: boolean;
    } | null;
    if (!body || typeof body.hint !== "string") {
      return setProblem({ text: "No hint this time, and nothing was charged. Please try again." });
    }
    setHint({
      level,
      text: body.hint,
      fallback: body.fallback === true,
      charged: body.charged === true,
    });
    onHint();
  }

  return (
    <section aria-labelledby="hint-heading" className="card">
      <h2 id="hint-heading">Hint ladder</h2>
      <p>Pick the smallest hint that could help. You see each cost before you spend it.</p>
      <ol style={{ listStyle: "none", padding: 0 }}>
        {HINT_LEVELS.map((name, i) => {
          const cost = CREDIT_COST_BY_LEVEL[i];
          return (
            <li key={name} className="rung">
              <button
                type="button"
                className="rung-btn"
                disabled={busy !== null}
                onClick={() => void ask(i + 1)}
                aria-label={`Level ${i + 1}, ${name}, ${cost === 0 ? "free" : `${cost} credits`}`}
              >
                {i + 1}. {name}
              </button>
              <span aria-hidden="true">{cost === 0 ? "free" : `${cost} cr`}</span>
            </li>
          );
        })}
      </ol>
      <div role="status" aria-live="polite" data-testid="hint-output">
        {busy !== null ? <p>Getting your level {busy} hint...</p> : null}
        {problem ? (
          <p className="card bad">
            {problem.text}
            {problem.link ? (
              <>
                {" "}
                <Link href={problem.link.href}>{problem.link.label}</Link>
              </>
            ) : null}
          </p>
        ) : null}
        {hint ? (
          <div className="card ok">
            <strong>
              Level {hint.level}, {HINT_LEVELS[hint.level - 1]}
            </strong>
            <p className="hint-text">{hint.text}</p>
            {hint.fallback ? <p className="crumb">This is a prepared hint.</p> : null}
            <p className="crumb">
              {hint.charged
                ? `${CREDIT_COST_BY_LEVEL[hint.level - 1]} credits used.`
                : "No credits used."}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>Unstuck</h1>
      <p>
        Get unstuck without being handed the answer. Ask for a hint, and climb the ladder one rung
        at a time, from a gentle nudge to a full reveal only when you need it.
      </p>
      <p>
        <Link href="/exercises">Exercises</Link> · <Link href="/plans">Plans</Link> ·{" "}
        <Link href="/signin">Sign in</Link> · <Link href="/account">Account</Link>
      </p>
    </main>
  );
}

import { safeNextPath } from "../../lib/auth/next-path";
import { AuthForm } from "../../components/auth/AuthForm";

export const metadata = { title: "Sign in or create account - Unstuck" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; next?: string | string[] }>;
}) {
  const { error, next } = await searchParams;
  const key = Array.isArray(error) ? error[0] : error;
  return (
    <main>
      <AuthForm
        next={next === undefined ? undefined : safeNextPath(next)}
        notice={
          key === "confirm"
            ? "That email link did not work. Enter your email to get a new code."
            : undefined
        }
      />
    </main>
  );
}

import { safeNextPath } from "../../lib/auth/next-path";
import { AuthForm } from "../../components/auth/AuthForm";

export const metadata = { title: "Sign in - Unstuck" };

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
        mode="signin"
        next={next === undefined ? undefined : safeNextPath(next)}
        notice={
          key === "confirm"
            ? "That confirmation link did not work. Sign in, or create the account again to get a new link."
            : undefined
        }
      />
    </main>
  );
}

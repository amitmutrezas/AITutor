import { AuthForm } from "../../components/auth/AuthForm";
import { safeNextPath } from "../../lib/auth/next-path";

export const metadata = { title: "Create account - Unstuck" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  return (
    <main>
      <AuthForm mode="signup" next={next === undefined ? undefined : safeNextPath(next)} />
    </main>
  );
}

import { redirect } from "next/navigation";
import { safeNextPath } from "../../lib/auth/next-path";

// Sign in and create account are the same screen now. Old links to /signup land on it.
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  redirect(
    next === undefined ? "/signin" : `/signin?next=${encodeURIComponent(safeNextPath(next))}`,
  );
}

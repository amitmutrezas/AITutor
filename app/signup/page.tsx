import { AuthForm } from "../../components/auth/AuthForm";

export const metadata = { title: "Create account - Unstuck" };

export default function SignUpPage() {
  return (
    <main>
      <AuthForm mode="signup" />
    </main>
  );
}

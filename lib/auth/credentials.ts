import { z } from "zod";
import { failed, json, readBody } from "../api/http";

export const credentialsBody = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  // 72 bytes is bcrypt's limit, which Supabase Auth uses.
  password: z.string().min(8).max(72),
});

export type SignUpResult = "signed_in" | "confirm_email" | "error";

/** Email + password sign-in (A1). The Supabase implementation sets the session cookies. */
export interface AuthProvider {
  signUp(email: string, password: string, confirmRedirectTo: string): Promise<SignUpResult>;
  signIn(email: string, password: string): Promise<boolean>;
  signOut(): Promise<void>;
}

export async function handleSignUp(req: Request, provider: AuthProvider): Promise<Response> {
  const body = await readBody(req, credentialsBody);
  if (!body.ok) return body.response;
  try {
    const confirmRedirectTo = new URL("/auth/confirm", req.url).toString();
    const result = await provider.signUp(body.data.email, body.data.password, confirmRedirectTo);
    if (result === "error") return json(400, { error: "Could not create the account" });
    return json(200, { status: result });
  } catch {
    return failed();
  }
}

export async function handleSignIn(req: Request, provider: AuthProvider): Promise<Response> {
  const body = await readBody(req, credentialsBody);
  if (!body.ok) return body.response;
  try {
    // One generic message for wrong email, wrong password and unconfirmed email.
    if (!(await provider.signIn(body.data.email, body.data.password))) {
      return json(401, { error: "Email or password is not right" });
    }
    return json(200, { status: "signed_in" });
  } catch {
    return failed();
  }
}

export async function handleSignOut(provider: AuthProvider): Promise<Response> {
  try {
    await provider.signOut();
    return json(200, { status: "signed_out" });
  } catch {
    return failed();
  }
}

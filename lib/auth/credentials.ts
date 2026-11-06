import { z } from "zod";
import { failed, json, readBody } from "../api/http";

// Sign-in is one email screen with a one-time code (A1). There are no passwords: the same two steps
// sign an existing learner in and create the account the first time an email is used.
const emailField = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const sendCodeBody = z.strictObject({ email: emailField });

export const verifyCodeBody = z.strictObject({
  email: emailField,
  // Supabase emails a numeric code, 6 digits by default and configurable up to 10.
  token: z
    .string()
    .trim()
    .regex(/^\d{6,10}$/),
});

export type SendCodeResult = "sent" | "rate_limited" | "error";

/** Email one-time-code sign-in (A1). The Supabase implementation sets the session cookies on verify. */
export interface AuthProvider {
  /** Emails a code. Creates the account if the email is new. */
  sendCode(email: string, confirmRedirectTo: string): Promise<SendCodeResult>;
  /** True when the code is right and a session was started. */
  verifyCode(email: string, token: string): Promise<boolean>;
  signOut(): Promise<void>;
}

export async function handleSendCode(req: Request, provider: AuthProvider): Promise<Response> {
  const body = await readBody(req, sendCodeBody);
  if (!body.ok) return body.response;
  try {
    const confirmRedirectTo = new URL("/auth/confirm", req.url).toString();
    const result = await provider.sendCode(body.data.email, confirmRedirectTo);
    if (result === "rate_limited") {
      return json(429, { error: "Too many codes requested. Wait a minute and try again" });
    }
    if (result === "error") return json(400, { error: "Could not send a code" });
    // Same answer for a new and an existing email, so this cannot be used to find out who has an account.
    return json(200, { status: "sent" });
  } catch {
    return failed();
  }
}

export async function handleVerifyCode(req: Request, provider: AuthProvider): Promise<Response> {
  const body = await readBody(req, verifyCodeBody);
  if (!body.ok) return body.response;
  try {
    // One generic message for a wrong, expired or already used code.
    if (!(await provider.verifyCode(body.data.email, body.data.token))) {
      return json(401, { error: "That code is not right or has expired" });
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

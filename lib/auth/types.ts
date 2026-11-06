export interface AuthUser {
  /** Opaque user id (uuid). Safe to log; the email is not. */
  id: string;
  email: string;
}

/** Resolves the signed-in user from a request's session cookie, or null. Never throws. */
export type Authenticate = (req: Request) => Promise<AuthUser | null>;

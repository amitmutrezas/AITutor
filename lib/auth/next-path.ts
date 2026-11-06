/**
 * Return path after sign-in (A1). Only a same-site absolute path is accepted, so the sign-in form
 * cannot be used as an open redirect. Anything else falls back to the account page.
 */
export const DEFAULT_AFTER_AUTH = "/account";

function hasUnsafeChar(value: string): boolean {
  for (const ch of value) {
    if (ch === "\\" || ch.charCodeAt(0) < 0x20) return true;
  }
  return false;
}

export function safeNextPath(raw: string | string[] | null | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || value.length > 200) return DEFAULT_AFTER_AUTH;
  // Must start with a single "/", and contain no backslash, control character or scheme tricks.
  if (!value.startsWith("/") || value.startsWith("//") || hasUnsafeChar(value)) {
    return DEFAULT_AFTER_AUTH;
  }
  try {
    const url = new URL(value, "https://unstuck.invalid");
    if (url.origin !== "https://unstuck.invalid") return DEFAULT_AFTER_AUTH;
    return url.pathname + url.search;
  } catch {
    return DEFAULT_AFTER_AUTH;
  }
}

// Editor code survives a reload (A2). Signed in: the saved-code API holds the latest code that was
// run. Signed out, or when that fails: localStorage on this device. Code is never logged (N3).
const KEY = (id: string) => `unstuck:code:${id}`;

export interface StoredCode {
  code: string;
  /** Epoch milliseconds of the last edit or save. */
  at: number;
}

export function readLocal(id: string): StoredCode | null {
  try {
    const raw = localStorage.getItem(KEY(id));
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (
      v &&
      typeof v === "object" &&
      typeof (v as StoredCode).code === "string" &&
      typeof (v as StoredCode).at === "number"
    ) {
      return { code: (v as StoredCode).code, at: (v as StoredCode).at };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeLocal(id: string, code: string, at: number = Date.now()): void {
  try {
    localStorage.setItem(KEY(id), JSON.stringify({ code, at }));
  } catch {
    /* storage unavailable or full: the code just is not remembered here */
  }
}

/** The newer of the server copy and the local copy, or null when there is neither. */
export function pickNewest(server: StoredCode | null, local: StoredCode | null): string | null {
  if (server && local) return local.at > server.at ? local.code : server.code;
  return (server ?? local)?.code ?? null;
}

/** Latest saved code for one exercise from the account, or null (signed out, none, or an error). */
export async function fetchServerCode(id: string): Promise<StoredCode | null> {
  try {
    const res = await fetch("/api/saved-code");
    if (!res.ok) return null;
    const body = (await res.json()) as {
      items?: { exerciseId: string; code: string; updatedAt: string }[];
    };
    const item = body.items?.find((i) => i.exerciseId === id);
    if (!item) return null;
    const at = Date.parse(item.updatedAt);
    return { code: item.code, at: Number.isNaN(at) ? 0 : at };
  } catch {
    return null;
  }
}

const HINTS_KEY = (id: string) => `unstuck:hints:${id}`;

/** Hints delivered for this exercise on this device (shown on the complete screen). */
export function readHintCount(id: string): number {
  try {
    const n = Number(localStorage.getItem(HINTS_KEY(id)));
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function writeHintCount(id: string, n: number): void {
  try {
    localStorage.setItem(HINTS_KEY(id), String(n));
  } catch {
    /* not remembered */
  }
}

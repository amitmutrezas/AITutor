import { createSupabaseAccounts, type AccountPort } from "../account/service";
import { createSupabaseAuthenticate } from "../auth/supabase";
import type { Authenticate } from "../auth/types";
import { createSupabaseCredits, type CreditsPort } from "../credits";
import { createServiceRpc } from "../db/service-client";
import { createAnthropicModel } from "../hints/anthropic";
import { createContentExerciseStore } from "../exercises/content";
import { createHintHandler, createRateLimiter } from "../hints/handler";
import { createSupabaseHintLog, type HintLogPort } from "../hints/hint-log";
import { createSupabasePaymentStore } from "../payments/supabase-store";
import type { PaymentStore } from "../payments/store";
import { createSupabaseSavedCode, type SavedCodePort } from "../saved-code/service";

export interface Services {
  authenticate: Authenticate;
  credits: CreditsPort;
  accounts: AccountPort;
  hintLog: HintLogPort;
  savedCode: SavedCodePort;
  payments: PaymentStore;
}

let services: Services | null | undefined;

/**
 * Production wiring: every adapter shares one service-role client. Built on first use (not at
 * import) so `next build` never needs secrets. Returns null when the env vars named in
 * .env.example are missing; routes then answer a generic 503 (fail closed).
 */
export function getServices(): Services | null {
  if (services !== undefined) return services;
  const db = createServiceRpc();
  services = db
    ? {
        authenticate: createSupabaseAuthenticate(),
        credits: createSupabaseCredits(db),
        accounts: createSupabaseAccounts(db),
        hintLog: createSupabaseHintLog(db),
        savedCode: createSupabaseSavedCode(db),
        payments: createSupabasePaymentStore(db),
      }
    : null;
  return services;
}

let hintHandler: ((req: Request) => Promise<Response>) | undefined;

export function getHintHandler(): ((req: Request) => Promise<Response>) | null {
  const s = getServices();
  if (!s) return null;
  hintHandler ??= createHintHandler({
    // Live exercises from content/exercises; the solution is read only for levels 4-5 and the leak check.
    loadExercise: createContentExerciseStore(),
    model: createAnthropicModel(),
    authenticate: s.authenticate,
    rateLimiter: createRateLimiter(),
    credits: s.credits,
    accounts: s.accounts,
    hintLog: s.hintLog,
  });
  return hintHandler;
}

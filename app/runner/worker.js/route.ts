// R1: serves the exercise Worker script with its OWN Content-Security-Policy. A dedicated worker
// enforces the CSP of its script response, so with default-src 'none' every network and module
// load (including same-origin import()) is denied. 'unsafe-eval' is needed for Function().
// This route imports only the static worker source text, never the runner (R3: nothing here
// executes learner code on the server).
import { WORKER_SOURCE } from "../../../lib/runner/workerSource";

export const dynamic = "force-static";

export function GET() {
  return new Response(WORKER_SOURCE, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-eval'",
      "Cache-Control": "public, max-age=300",
    },
  });
}

import { outcomeFromMessage, timeoutOutcome } from "./results";
import type { RunOutcome } from "./types";
import { WORKER_SOURCE } from "./workerSource";

/** Default time limit for learner code (R1). */
export const DEFAULT_TIME_LIMIT_MS = 2000;

/** The slice of Worker we use; lets tests inject a fake without a browser. */
export interface WorkerLike {
  postMessage(msg: unknown): void;
  terminate(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: { message?: string }) => void) | null;
}

export type WorkerFactory = () => WorkerLike;

/** Thin browser glue: Blob URL worker. Only called from client components. */
export function browserWorkerFactory(): WorkerLike {
  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
  const w = new Worker(url);
  URL.revokeObjectURL(url);
  return w as unknown as WorkerLike;
}

/** Run learner code against tests; always terminates the worker; times out (R1). */
export function runInSandbox(
  code: string,
  tests: string,
  opts: { timeLimitMs?: number; factory?: WorkerFactory } = {},
): Promise<RunOutcome> {
  const limit = opts.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;
  const worker = (opts.factory ?? browserWorkerFactory)();
  return new Promise<RunOutcome>((resolve) => {
    let settled = false;
    const finish = (o: RunOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(o);
    };
    const timer = setTimeout(() => finish(timeoutOutcome(limit)), limit);
    worker.onmessage = (ev) => finish(outcomeFromMessage(ev.data));
    worker.onerror = (ev) =>
      finish({ status: "error", message: ev.message || "Your code could not be run.", results: [] });
    worker.postMessage({ code, tests });
  });
}

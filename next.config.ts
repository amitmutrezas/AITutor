import type { NextConfig } from "next";

// R1: page-level policy. The exercise Worker script (/runner/worker.js) is excluded below because
// its route sets its own stricter CSP, which the worker enforces (blocks even same-origin imports).
// 'unsafe-inline' and 'unsafe-eval' are needed by Next.js and by the Function-based test harness.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Exercises are read from content/exercises at request time; make sure the files ship with the
  // server bundles that read them (list, workspace, hint route).
  outputFileTracingIncludes: {
    "/exercises": ["./content/exercises/**/*.json"],
    "/exercises/[id]": ["./content/exercises/**/*.json"],
    "/api/hint": ["./content/exercises/**/*.json"],
  },
  async headers() {
    return [{ source: "/((?!runner/worker\\.js).*)", headers: [{ key: "Content-Security-Policy", value: csp }] }];
  },
};

export default nextConfig;

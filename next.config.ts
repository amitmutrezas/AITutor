import type { NextConfig } from "next";

// R1: the exercise Worker is created from a Blob URL and inherits this policy. script-src without
// remote hosts blocks dynamic import() of external modules; connect-src blocks fetch/XHR/WebSocket.
// 'unsafe-inline' and 'unsafe-eval' are needed by Next.js and by the Function-based test harness.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Content-Security-Policy", value: csp }] }];
  },
};

export default nextConfig;

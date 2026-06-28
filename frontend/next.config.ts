import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Baseline CSP. script/style allow 'unsafe-inline' (Next injects inline runtime
// without a nonce); the value is in locking down framing, base-uri, object-src,
// and where the page may connect (self + the API origin, for fetch + SSE).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${API_ORIGIN} ws: wss:`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // Let the e2e build target an isolated output dir (NEXT_DIST_DIR=.next-e2e) so
  // `next build`/`next start` never clobbers a developer's running `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Pin the file-tracing root to this project so a stray parent lockfile
  // (e.g. ~/yarn.lock) can't mis-root the standalone build.
  outputFileTracingRoot: import.meta.dirname,
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default withNextIntl(nextConfig);

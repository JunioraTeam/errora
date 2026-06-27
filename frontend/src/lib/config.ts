/**
 * Client feature flags (build-time, via NEXT_PUBLIC_* env).
 */

/**
 * One-time-code (OTP) login. Temporarily disabled by default; set
 * NEXT_PUBLIC_OTP_ENABLED="true" to re-enable the OTP method + its tab.
 */
export const OTP_ENABLED = process.env.NEXT_PUBLIC_OTP_ENABLED === "true";

/**
 * Public site origin, used as the metadata base for absolute OpenGraph/Twitter
 * URLs. Set NEXT_PUBLIC_SITE_URL in production (e.g. https://errora.example.com).
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "http://localhost:3000";

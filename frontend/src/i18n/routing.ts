import { createNavigation } from "next-intl/navigation";
import { defineRouting } from "next-intl/routing";

export const locales = ["fa", "en"] as const;
export type Locale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale: "fa",
  // Default locale (fa) is served at the root with no /fa prefix; en lives under /en.
  localePrefix: "as-needed",
  // Don't auto-redirect based on the browser's Accept-Language header — an
  // unprefixed path like /projects must stay on the default locale (fa) rather
  // than bouncing to /en for English-preferring browsers.
  localeDetection: false,
});

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);

export function isRtl(locale: string): boolean {
  return locale === "fa";
}

export function dirFor(locale: string): "rtl" | "ltr" {
  return isRtl(locale) ? "rtl" : "ltr";
}

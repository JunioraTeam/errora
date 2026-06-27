/**
 * Tiny classname combiner (no external dep). Filters falsy, joins with space.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Per-locale digit glyphs. Persian (fa) → Persian digits; Arabic (ar) →
 * Arabic-Indic digits; everything else stays ASCII.
 */
const DIGIT_MAPS: Record<string, string[]> = {
  fa: ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"],
  ar: ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"],
};

/** Convert ASCII digits in a string to the given locale's digit glyphs. */
export function localizeDigits(input: string | number, locale: string): string {
  const map = DIGIT_MAPS[locale];
  const s = String(input);
  return map ? s.replace(/[0-9]/g, (d) => map[Number(d)]) : s;
}

/** Back-compat: convert to Persian digits. */
export function toPersianDigits(input: string | number): string {
  return localizeDigits(input, "fa");
}

/** Thousands separator per locale (Arabic/Persian use ٬). */
function groupSeparator(locale: string): string {
  return locale === "fa" || locale === "ar" ? "٬" : ",";
}

/**
 * Group an integer with thousands separators and localize digits.
 * fa/ar → localized digits + ٬ separator; en → ASCII digits + comma.
 */
export function formatNumber(value: number, locale: string): string {
  const grouped = Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, groupSeparator(locale));
  return localizeDigits(grouped, locale);
}

/**
 * Format a Toman price. Returns just the grouped number; callers append the
 * "Toman / month" label from the message catalog so it stays translatable.
 */
export function formatToman(value: number, locale: string): string {
  return formatNumber(value, locale);
}

/**
 * Compact event counts: 1500 → ۱٫۵ هزار / 1.5k, 2_300_000 → ۲٫۳ م / 2.3M
 */
export function formatCompact(value: number, locale: string): string {
  const fa = locale === "fa";
  const intl = locale === "fa" || locale === "ar";
  const dec = (n: number) => {
    const s = (Math.round(n * 10) / 10).toString().replace(".", intl ? "٫" : ".");
    return localizeDigits(s, locale);
  };
  if (value >= 1_000_000) return `${dec(value / 1_000_000)}${fa ? " م" : "M"}`;
  if (value >= 1_000) return `${dec(value / 1_000)}${fa ? " هزار" : "k"}`;
  return formatNumber(value, locale);
}

/**
 * Format a millisecond duration for display: <1000ms → "Nms", else "N.NNs".
 * Digits are localized; the unit stays ASCII (ms/s read fine in fa/ar).
 */
export function formatDuration(ms: number | null | undefined, locale: string): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${localizeDigits(Math.round(ms), locale)}ms`;
  return `${localizeDigits((ms / 1000).toFixed(2), locale)}s`;
}

/** Format a 0–1 fraction as a localized percentage (one decimal). */
export function formatPercent(fraction: number, locale: string): string {
  return `${localizeDigits((fraction * 100).toFixed(1), locale)}%`;
}

/** Format a throughput rate (transactions per minute), localized. */
export function formatRate(tpm: number, locale: string): string {
  const v = tpm >= 10 ? Math.round(tpm).toString() : tpm.toFixed(2);
  return localizeDigits(v, locale);
}

export type RelativeTime = {
  key: "now" | "secondsAgo" | "minutesAgo" | "hoursAgo" | "daysAgo" | "monthsAgo" | "yearsAgo";
  count: number;
};

/**
 * Pure relative-time bucketer. Returns a message key + count so the actual
 * string comes from the translation catalog (keeps it i18n-friendly).
 */
export function relativeTime(
  date: Date | string | number,
  now: Date | number = Date.now()
): RelativeTime {
  const then = new Date(date).getTime();
  const nowMs = typeof now === "number" ? now : now.getTime();
  const diff = Math.max(0, Math.floor((nowMs - then) / 1000));

  if (diff < 10) return { key: "now", count: 0 };
  if (diff < 60) return { key: "secondsAgo", count: diff };
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return { key: "minutesAgo", count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: "hoursAgo", count: hours };
  const days = Math.floor(hours / 24);
  if (days < 30) return { key: "daysAgo", count: days };
  const months = Math.floor(days / 30);
  if (months < 12) return { key: "monthsAgo", count: months };
  const years = Math.floor(months / 12);
  return { key: "yearsAgo", count: years };
}

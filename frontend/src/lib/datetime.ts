/**
 * Calendar + date formatting. Persian (fa) uses the Jalali (Shamsi) calendar;
 * other locales use Gregorian. The Gregorian↔Jalali conversion is the
 * well-known jalaali-js algorithm (MIT), vendored here so we add no dependency.
 *
 * Everything that leaves the UI as a value stays Gregorian ISO (YYYY-MM-DD) so
 * the backend is unaffected; only the *display* and the calendar grid differ.
 */

import { localizeDigits } from "./utils";

// ---- jalaali-js core (MIT) ------------------------------------------------ //
// NB: jalaali-js truncates toward zero (`~~`), not floor — they differ for
// negative quotients such as div(gm - 8, 6).
function div(a: number, b: number): number {
  return Math.trunc(a / b);
}
function mod(a: number, b: number): number {
  return a % b;
}

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394,
  2456, 3178,
];

function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;
  for (let i = 1; i < BREAKS.length; i += 1) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn: number): { jy: number; jm: number; jd: number } {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

export type JalaliDate = { jy: number; jm: number; jd: number };

export function toJalali(d: Date): JalaliDate {
  return d2j(g2d(d.getFullYear(), d.getMonth() + 1, d.getDate()));
}

export function jalaliToDate(jy: number, jm: number, jd: number): Date {
  const g = d2g(j2d(jy, jm, jd));
  return new Date(g.gy, g.gm - 1, g.gd);
}

export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return jalCal(jy).leap === 0 ? 30 : 29;
}

// ---- Names ---------------------------------------------------------------- //
export const JALALI_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

// Persian week starts on Saturday.
export const JALALI_WEEKDAYS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

const GREGORIAN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export const GREGORIAN_WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function isJalaliLocale(locale: string): boolean {
  return locale === "fa";
}

// ---- Formatting ----------------------------------------------------------- //
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Format a date (no time) for display in the given locale. */
export function formatDate(input: Date | string | number, locale: string): string {
  const d = new Date(input);
  if (isJalaliLocale(locale)) {
    const { jy, jm, jd } = toJalali(d);
    return localizeDigits(`${jd} ${JALALI_MONTHS[jm - 1]} ${jy}`, locale);
  }
  return `${GREGORIAN_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Format a date + HH:MM for display in the given locale. */
export function formatDateTime(input: Date | string | number, locale: string): string {
  const d = new Date(input);
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return `${formatDate(d, locale)} ${localizeDigits(time, locale)}`;
}

/**
 * Format a "YYYY-MM-DD" day key for display. In fa it becomes a Jalali date;
 * other locales keep the ISO key (parsed as a *local* date to avoid TZ drift).
 */
export function formatDayKey(iso: string, locale: string): string {
  if (!isJalaliLocale(locale)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return formatDate(new Date(y, m - 1, d), locale);
}

/**
 * Format a "YYYY-MM" month key for display. In fa it becomes a Jalali
 * "month year" (using the 15th to avoid month-boundary drift); other locales
 * keep the period string (digits localized).
 */
export function formatMonthKey(period: string, locale: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return localizeDigits(period, locale);
  if (isJalaliLocale(locale)) {
    const { jy, jm } = toJalali(new Date(y, m - 1, 15));
    return localizeDigits(`${JALALI_MONTHS[jm - 1]} ${jy}`, locale);
  }
  return localizeDigits(period, locale);
}

/** Current calendar year for the locale (Jalali year for fa), localized digits. */
export function localizedYear(locale: string): string {
  const now = new Date();
  const year = isJalaliLocale(locale) ? toJalali(now).jy : now.getFullYear();
  return localizeDigits(year, locale);
}

// ---- Calendar grid (for the date picker) ---------------------------------- //
export type CalendarCell = {
  /** Gregorian date this cell represents. */
  date: Date;
  /** Day-of-month label in the active calendar (already a number). */
  day: number;
  /** Whether the cell belongs to the displayed month. */
  inMonth: boolean;
};

/**
 * Build a 6×7 day grid for the month containing `cursor`, in the calendar that
 * matches `locale`. Returns cells plus the month/year title.
 */
export function monthGrid(
  cursor: Date,
  locale: string
): { cells: CalendarCell[]; title: string; weekdays: string[] } {
  if (isJalaliLocale(locale)) return jalaliGrid(cursor, locale);
  return gregorianGrid(cursor, locale);
}

function jalaliGrid(cursor: Date, locale: string) {
  const { jy, jm } = toJalali(cursor);
  const first = jalaliToDate(jy, jm, 1);
  // Persian week starts Saturday(6). JS getDay: Sun=0..Sat=6.
  const lead = (first.getDay() + 1) % 7;
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const offset = i - lead;
    const date = new Date(first);
    date.setDate(first.getDate() + offset);
    const j = toJalali(date);
    cells.push({ date, day: j.jd, inMonth: j.jy === jy && j.jm === jm });
  }
  const title = localizeDigits(`${JALALI_MONTHS[jm - 1]} ${jy}`, locale);
  return { cells, title, weekdays: JALALI_WEEKDAYS };
}

function gregorianGrid(cursor: Date, _locale: string) {
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const first = new Date(y, m, 1);
  const lead = first.getDay(); // Sunday-first
  const length = new Date(y, m + 1, 0).getDate();
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const offset = i - lead;
    const date = new Date(y, m, 1 + offset);
    cells.push({
      date,
      day: date.getDate(),
      inMonth: date.getMonth() === m,
    });
  }
  // `length` retained for clarity; grid is fixed at 42 cells.
  void length;
  return {
    cells,
    title: `${GREGORIAN_MONTHS[m]} ${y}`,
    weekdays: GREGORIAN_WEEKDAYS,
  };
}

/** Step the cursor by ±1 month in the active calendar. */
export function addMonth(cursor: Date, delta: number, locale: string): Date {
  if (isJalaliLocale(locale)) {
    const { jy, jm } = toJalali(cursor);
    let ny = jy;
    let nm = jm + delta;
    while (nm > 12) {
      nm -= 12;
      ny += 1;
    }
    while (nm < 1) {
      nm += 12;
      ny -= 1;
    }
    const day = Math.min(toJalali(cursor).jd, jalaliMonthLength(ny, nm));
    return jalaliToDate(ny, nm, day);
  }
  return new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
}

/** Gregorian ISO date (YYYY-MM-DD) for a Date, in local time. */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

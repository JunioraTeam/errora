import { describe, it, expect } from "vitest";
import {
  cn,
  toPersianDigits,
  formatNumber,
  formatToman,
  formatCompact,
  relativeTime,
} from "@/lib/utils";
import { paygCost, annualPrice, PAYG } from "@/lib/pricing";

describe("cn", () => {
  it("joins truthy classes and drops falsy ones", () => {
    expect(cn("a", false, "b", null, undefined, "c")).toBe("a b c");
  });
});

describe("toPersianDigits", () => {
  it("converts ASCII digits to Persian digits", () => {
    expect(toPersianDigits("2024")).toBe("۲۰۲۴");
    expect(toPersianDigits(0)).toBe("۰");
  });
});

describe("formatNumber", () => {
  it("groups thousands with Persian digits + separator for fa", () => {
    expect(formatNumber(299000, "fa")).toBe("۲۹۹٬۰۰۰");
  });
  it("groups thousands with comma for en", () => {
    expect(formatNumber(299000, "en")).toBe("299,000");
  });
  it("handles small numbers", () => {
    expect(formatNumber(0, "en")).toBe("0");
    expect(formatNumber(42, "fa")).toBe("۴۲");
  });
});

describe("formatToman", () => {
  it("formats a Toman price as a grouped number (fa)", () => {
    expect(formatToman(299000, "fa")).toBe("۲۹۹٬۰۰۰");
  });
});

describe("formatCompact", () => {
  it("compacts thousands and millions", () => {
    expect(formatCompact(1500, "en")).toBe("1.5k");
    expect(formatCompact(2_300_000, "en")).toBe("2.3M");
  });
  it("uses Persian markers for fa", () => {
    expect(formatCompact(1500, "fa")).toBe("۱٫۵ هزار");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-06-19T12:00:00Z").getTime();
  it("returns 'now' for very recent timestamps", () => {
    expect(relativeTime(now - 2000, now)).toEqual({ key: "now", count: 0 });
  });
  it("buckets minutes", () => {
    expect(relativeTime(now - 5 * 60 * 1000, now)).toEqual({
      key: "minutesAgo",
      count: 5,
    });
  });
  it("buckets hours", () => {
    expect(relativeTime(now - 3 * 60 * 60 * 1000, now)).toEqual({
      key: "hoursAgo",
      count: 3,
    });
  });
  it("buckets days", () => {
    expect(relativeTime(now - 2 * 24 * 60 * 60 * 1000, now)).toEqual({
      key: "daysAgo",
      count: 2,
    });
  });
});

describe("pricing", () => {
  it("paygCost is zero within the free allowance", () => {
    expect(paygCost(PAYG.freeEvents)).toBe(0);
    expect(paygCost(0)).toBe(0);
  });
  it("paygCost charges per 1k events beyond the free allowance", () => {
    // 10k events => 5k billable => 5 units * pricePerThousand
    const cost = paygCost(10_000);
    expect(cost).toBe(5 * PAYG.pricePerThousand);
  });
  it("annualPrice bills 10 months", () => {
    expect(annualPrice(299000)).toBe(2_990_000);
  });
});

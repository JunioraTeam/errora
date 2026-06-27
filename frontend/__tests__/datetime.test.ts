import { describe, expect, it } from "vitest";
import { formatDate, jalaliToDate, localizedYear, toJalali } from "@/lib/datetime";
import { formatNumber, localizeDigits } from "@/lib/utils";

describe("jalali conversion", () => {
  it("maps Nowruz 1403 to 2024-03-20", () => {
    const j = toJalali(new Date(2024, 2, 20));
    expect(j).toEqual({ jy: 1403, jm: 1, jd: 1 });
  });

  it("round-trips Gregorian → Jalali → Gregorian", () => {
    for (const d of [new Date(2026, 5, 25), new Date(2020, 0, 1), new Date(1999, 11, 31)]) {
      const { jy, jm, jd } = toJalali(d);
      const back = jalaliToDate(jy, jm, jd);
      expect(back.getFullYear()).toBe(d.getFullYear());
      expect(back.getMonth()).toBe(d.getMonth());
      expect(back.getDate()).toBe(d.getDate());
    }
  });
});

describe("date formatting", () => {
  it("formats Jalali with Persian digits + month name for fa", () => {
    const s = formatDate(new Date(2024, 2, 20), "fa");
    expect(s).toContain("فروردین");
    expect(s).toContain("۱۴۰۳");
  });

  it("formats Gregorian for en", () => {
    expect(formatDate(new Date(2024, 2, 20), "en")).toBe("March 20, 2024");
  });

  it("returns a Jalali year for fa in localizedYear", () => {
    // The Jalali year is always Gregorian - 622 or - 621.
    const gy = new Date().getFullYear();
    const fa = localizedYear("fa");
    const asciiYear = Number(fa.replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d).toString()));
    expect([gy - 621, gy - 622]).toContain(asciiYear);
  });
});

describe("digit localization", () => {
  it("localizes digits per locale", () => {
    expect(localizeDigits("2026", "fa")).toBe("۲۰۲۶");
    expect(localizeDigits("2026", "ar")).toBe("٢٠٢٦");
    expect(localizeDigits("2026", "en")).toBe("2026");
  });

  it("groups and localizes numbers", () => {
    expect(formatNumber(1234567, "en")).toBe("1,234,567");
    expect(formatNumber(1234, "fa")).toBe("۱٬۲۳۴");
    expect(formatNumber(1234, "ar")).toBe("١٬٢٣٤");
  });
});

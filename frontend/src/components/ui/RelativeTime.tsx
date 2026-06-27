"use client";

import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { formatDateTime } from "@/lib/datetime";
import { localizeDigits, relativeTime } from "@/lib/utils";

export function RelativeTime({ date }: { date: string | number | Date }) {
  const t = useTranslations("time");
  const locale = useLocale();
  // Recompute on an interval so "x minutes ago" stays fresh.
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const id = setInterval(force, 60_000);
    return () => clearInterval(id);
  }, []);

  const { key, count } = relativeTime(date);
  return (
    <time dateTime={new Date(date).toISOString()} title={formatDateTime(date, locale)}>
      {key === "now" ? t("now") : t(key, { count: localizeDigits(count, locale) })}
    </time>
  );
}

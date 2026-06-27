"use client";

import { useLocale } from "next-intl";
import * as React from "react";
import { createPortal } from "react-dom";
import { formatDateTime, formatDayKey, toISODate } from "@/lib/datetime";
import { cn, formatNumber } from "@/lib/utils";

type Tip = { x: number; y: number; date: string; count: string };

/**
 * Tiny inline bar chart of per-bucket event counts (Sentry-style issue trend).
 * The series ends now, so bar ``i`` is ``n-1-i`` buckets ago; ``unit`` controls
 * whether a bucket is a day (30d window) or an hour (24h window). Hovering shows
 * a label + count tooltip through a portal so it isn't clipped by the
 * surrounding (overflow-hidden) table card.
 */
export function Sparkline({
  data,
  className,
  unit = "day",
}: {
  data: number[];
  className?: string;
  unit?: "day" | "hour";
}) {
  const locale = useLocale();
  const max = Math.max(1, ...data);
  const n = data.length;
  const [tip, setTip] = React.useState<Tip | null>(null);

  const dateFor = (i: number) => {
    const d = new Date();
    if (unit === "hour") {
      d.setMinutes(0, 0, 0);
      d.setHours(d.getHours() - (n - 1 - i));
      return formatDateTime(d.getTime(), locale);
    }
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (n - 1 - i));
    return formatDayKey(toISODate(d), locale);
  };

  return (
    <div className={cn("flex h-7 w-24 items-end gap-px", className)}>
      {data.map((v, i) => (
        <div
          key={i}
          role="img"
          aria-label={`${dateFor(i)}: ${formatNumber(v, locale)}`}
          className="flex-1 rounded-sm bg-accent/60 transition-colors hover:bg-accent"
          style={{ height: `${Math.max(8, Math.round((v / max) * 100))}%` }}
          onMouseEnter={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setTip({
              x: r.left + r.width / 2,
              y: r.top,
              date: dateFor(i),
              count: formatNumber(v, locale),
            });
          }}
          onMouseLeave={() => setTip(null)}
        />
      ))}
      {tip &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: tip.x,
              top: tip.y - 8,
              transform: "translate(-50%, -100%)",
            }}
            className="pointer-events-none z-[100] flex items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] border border-border bg-card px-2 py-1 text-[11px] shadow-md"
          >
            <span className="font-medium">{tip.date}</span>
            <span dir="ltr" className="tabular-nums text-muted-foreground">
              {tip.count}
            </span>
          </div>,
          document.body
        )}
    </div>
  );
}

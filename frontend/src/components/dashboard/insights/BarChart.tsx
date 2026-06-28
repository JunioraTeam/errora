"use client";

import { AnimatePresence, motion } from "motion/react";
import { useLocale } from "next-intl";
import * as React from "react";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { cn, formatCompact, formatNumber } from "@/lib/utils";

// Shared smooth show/hide for the floating hover tooltips. ``x: "-50%"`` keeps
// the tooltip horizontally centred on its bar while motion drives the transform
// (so it isn't clobbered by a Tailwind ``-translate-x-1/2`` class).
const TIP_MOTION = {
  initial: { opacity: 0, y: 4, x: "-50%" },
  animate: { opacity: 1, y: 0, x: "-50%" },
  exit: { opacity: 0, y: 4, x: "-50%" },
  transition: { duration: 0.15, ease: "easeOut" },
} as const;
const TIP_CLASS =
  "pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-[var(--radius-sm)] border border-border bg-card px-2 py-1 text-xs shadow-md";

// Center the tooltip on its bar, but keep it off the chart edges so the
// (x: -50%) box can't overflow the card on the first/last bar.
const tipLeft = (i: number, n: number) =>
  `${Math.min(94, Math.max(6, ((i + 0.5) / Math.max(1, n)) * 100))}%`;

// x-axis tick indices: first / middle / last (or each when ≤3, none when empty).
const xTicks = (n: number) =>
  n < 1 ? [] : n <= 3 ? Array.from({ length: n }, (_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];

/**
 * Time-bucketed bar chart with x/y axes and a hover tooltip. Each bar is one
 * series bucket (``start + i * widthMinutes``); hovering shows the bucket's time
 * range and value. Dependency-free (divs + a portal-free absolute tooltip; the
 * card around it is not overflow-clipped).
 */
export function BarChart({
  data,
  start,
  widthMinutes,
  unit,
  label,
  color = "bg-accent",
  formatValue,
}: {
  data: number[];
  start: string;
  widthMinutes: number;
  unit: "hour" | "day";
  label: string;
  color?: string;
  formatValue?: (n: number) => string;
}) {
  const locale = useLocale();
  const [hover, setHover] = React.useState<number | null>(null);
  const max = Math.max(1, ...data);
  const n = data.length;
  const fmtV = formatValue ?? ((v: number) => formatCompact(v, locale));

  const startMs = Date.parse(start);
  const bucketMs = widthMinutes * 60_000;
  const labelAt = (i: number) => {
    const ms = startMs + i * bucketMs;
    return unit === "hour" ? formatDateTime(ms, locale) : formatDate(ms, locale);
  };

  // y-axis ticks (top = max, mid, 0) and a sparse set of x ticks.
  const yTicks = [max, max / 2, 0];
  const xIdx = xTicks(n);

  return (
    <div className="flex gap-2" dir="ltr">
      {/* y-axis */}
      <div className="flex w-9 shrink-0 flex-col justify-between py-0.5 text-end text-[10px] tabular-nums text-muted-foreground">
        {yTicks.map((v, i) => (
          <span key={i}>{formatCompact(Math.round(v), locale)}</span>
        ))}
      </div>

      <div className="min-w-0 flex-1">
        {/* plot area */}
        <div className="relative h-36">
          {/* gridlines */}
          {[0, 50, 100].map((p) => (
            <div
              key={p}
              className="absolute inset-x-0 border-t border-border/60"
              style={{ top: `${p}%` }}
              aria-hidden
            />
          ))}

          {/* bars */}
          <div className="absolute inset-0 flex items-end gap-px">
            {data.map((v, i) => (
              <button
                type="button"
                key={i}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                onFocus={() => setHover(i)}
                onBlur={() => setHover((h) => (h === i ? null : h))}
                className="group relative flex h-full flex-1 items-end justify-center"
                aria-label={`${labelAt(i)}: ${fmtV(v)}`}
              >
                <span
                  className={cn(
                    "mx-auto w-full max-w-[26px] rounded-t-sm transition-opacity",
                    color,
                    hover !== null && hover !== i ? "opacity-40" : "opacity-100",
                    v === 0 && "opacity-20"
                  )}
                  style={{ height: `${max > 0 ? (v / max) * 100 : 0}%`, minHeight: v > 0 ? 2 : 0 }}
                />
              </button>
            ))}
          </div>

          {/* tooltip */}
          <AnimatePresence>
            {hover !== null && (
              <motion.div
                key="tip"
                {...TIP_MOTION}
                className={TIP_CLASS}
                style={{ left: tipLeft(hover, n) }}
              >
                <div className="font-medium">{labelAt(hover)}</div>
                <div className="text-muted-foreground">
                  {label}:{" "}
                  <span className="font-medium text-foreground">
                    {formatNumber(data[hover], locale)}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* x-axis */}
        <div className="relative mt-1 h-4 text-[10px] tabular-nums text-muted-foreground">
          {xIdx.map((i) => (
            <span
              key={i}
              className={cn(
                "absolute -translate-x-1/2 whitespace-nowrap",
                i === 0 && "translate-x-0",
                i === n - 1 && "-translate-x-full"
              )}
              style={{ left: `${((i + 0.5) / Math.max(1, n)) * 100}%` }}
            >
              {labelAt(i)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Stacked time-bucketed bar chart: each bucket is a vertical stack of segments
 * (e.g. input vs output tokens), one per ``series`` entry. Shares the axes /
 * capped-width / hover behaviour of {@link BarChart}; the tooltip lists every
 * series value for the hovered bucket. ``series`` are stacked bottom-up in order.
 */
export function StackedBarChart({
  series,
  start,
  widthMinutes,
  unit,
}: {
  series: { data: number[]; label: string; cls: string }[];
  start: string;
  widthMinutes: number;
  unit: "hour" | "day";
}) {
  const locale = useLocale();
  const [hover, setHover] = React.useState<number | null>(null);
  const n = Math.max(0, ...series.map((s) => s.data.length));
  const totals = Array.from({ length: n }, (_, i) =>
    series.reduce((sum, s) => sum + (s.data[i] ?? 0), 0)
  );
  const max = Math.max(1, ...totals);

  const startMs = Date.parse(start);
  const bucketMs = widthMinutes * 60_000;
  const labelAt = (i: number) => {
    const ms = startMs + i * bucketMs;
    return unit === "hour" ? formatDateTime(ms, locale) : formatDate(ms, locale);
  };

  const yTicks = [max, max / 2, 0];
  const xIdx = xTicks(n);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span className={cn("h-2.5 w-2.5 rounded-sm", s.cls)} aria-hidden />
            {s.label}
          </span>
        ))}
      </div>

      <div className="flex gap-2" dir="ltr">
        <div className="flex w-9 shrink-0 flex-col justify-between py-0.5 text-end text-[10px] tabular-nums text-muted-foreground">
          {yTicks.map((v, i) => (
            <span key={i}>{formatCompact(Math.round(v), locale)}</span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative h-36">
            {[0, 50, 100].map((p) => (
              <div
                key={p}
                className="absolute inset-x-0 border-t border-border/60"
                style={{ top: `${p}%` }}
                aria-hidden
              />
            ))}

            <div className="absolute inset-0 flex items-end gap-px">
              {totals.map((tot, i) => (
                <button
                  type="button"
                  key={i}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover((h) => (h === i ? null : h))}
                  className="relative flex h-full flex-1 items-end justify-center"
                  aria-label={`${labelAt(i)}: ${formatNumber(tot, locale)}`}
                >
                  <span
                    className={cn(
                      "mx-auto flex w-full max-w-[26px] flex-col-reverse overflow-hidden rounded-t-sm transition-opacity",
                      hover !== null && hover !== i ? "opacity-40" : "opacity-100"
                    )}
                    style={{ height: `${max > 0 ? (tot / max) * 100 : 0}%`, minHeight: tot > 0 ? 2 : 0 }}
                  >
                    {series.map((s) => (
                      <span
                        key={s.label}
                        className={s.cls}
                        style={{ height: `${tot > 0 ? ((s.data[i] ?? 0) / tot) * 100 : 0}%` }}
                        aria-hidden
                      />
                    ))}
                  </span>
                </button>
              ))}
            </div>

            <AnimatePresence>
              {hover !== null && (
                <motion.div
                  key="tip"
                  {...TIP_MOTION}
                  className={TIP_CLASS}
                  style={{ left: tipLeft(hover, n) }}
                >
                  <div className="font-medium">{labelAt(hover)}</div>
                  {series.map((s) => (
                    <div key={s.label} className="flex items-center gap-1.5 text-muted-foreground">
                      <span className={cn("h-2 w-2 rounded-sm", s.cls)} aria-hidden />
                      {s.label}:{" "}
                      <span className="font-medium text-foreground">
                        {formatNumber(s.data[hover] ?? 0, locale)}
                      </span>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="relative mt-1 h-4 text-[10px] tabular-nums text-muted-foreground">
            {xIdx.map((i) => (
              <span
                key={i}
                className={cn(
                  "absolute -translate-x-1/2 whitespace-nowrap",
                  i === 0 && "translate-x-0",
                  i === n - 1 && "-translate-x-full"
                )}
                style={{ left: `${((i + 0.5) / Math.max(1, n)) * 100}%` }}
              >
                {labelAt(i)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

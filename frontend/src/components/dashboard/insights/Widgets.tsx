"use client";

import { useLocale } from "next-intl";
import type * as React from "react";
import { Card } from "@/components/ui/Card";
import type { InsightsBreakdown } from "@/lib/types";
import { cn, formatCompact, formatNumber } from "@/lib/utils";

const TOKEN_SEGS = [
  { key: "cached", cls: "bg-accent/40" },
  { key: "notCached", cls: "bg-accent" },
  { key: "output", cls: "bg-success" },
] as const;

/** Shared cached/not-cached/output color legend. */
export function TokenLegend({
  labels,
}: {
  labels: { cached: string; notCached: string; output: string };
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {TOKEN_SEGS.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className={cn("h-2.5 w-2.5 rounded-sm", s.cls)} aria-hidden />
          {labels[s.key]}
        </span>
      ))}
    </div>
  );
}

/** A single headline metric tile (agent runs, tokens, …). */
export function StatTile({
  label,
  value,
  sub,
  icon,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  tone?: "default" | "danger" | "accent";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div
        className={cn(
          "mt-2 text-2xl font-bold tabular-nums tracking-tight",
          tone === "danger" && "text-danger",
          tone === "accent" && "text-accent"
        )}
        dir="ltr"
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

/** A titled top-N list with a proportional bar behind each row. */
export function BreakdownList({
  title,
  items,
  empty,
  getValue,
  formatValue,
}: {
  title: string;
  items: InsightsBreakdown[];
  empty: string;
  getValue?: (it: InsightsBreakdown) => number;
  formatValue?: (it: InsightsBreakdown) => string;
}) {
  const locale = useLocale();
  const val = getValue ?? ((it: InsightsBreakdown) => it.count);
  const max = Math.max(1, ...items.map(val));
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border px-4 py-3 text-sm font-semibold">{title}</div>
      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((it) => (
            <li key={it.key} className="relative px-4 py-2.5">
              <div
                className="absolute inset-y-0 start-0 bg-accent-soft"
                style={{ width: `${(val(it) / max) * 100}%` }}
                aria-hidden
              />
              <div className="relative flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-mono text-xs" dir="ltr" title={it.key}>
                  {it.key}
                </span>
                <span className="shrink-0 tabular-nums text-sm font-medium" dir="ltr">
                  {formatValue ? formatValue(it) : formatCompact(val(it), locale)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Stacked token-usage bar: cached vs fresh input, plus output. */
export function TokenBar({
  title,
  cached,
  notCached,
  output,
  labels,
}: {
  title: string;
  cached: number;
  notCached: number;
  output: number;
  labels: { cached: string; notCached: string; output: string };
}) {
  const locale = useLocale();
  const total = Math.max(1, cached + notCached + output);
  const seg = [
    { key: "cached", value: cached, label: labels.cached, cls: "bg-accent/40" },
    { key: "notCached", value: notCached, label: labels.notCached, cls: "bg-accent" },
    { key: "output", value: output, label: labels.output, cls: "bg-success" },
  ];
  return (
    <Card className="p-4">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {seg.map((s) => (
          <div
            key={s.key}
            className={s.cls}
            style={{ width: `${(s.value / total) * 100}%` }}
            aria-hidden
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {seg.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className={cn("h-2.5 w-2.5 rounded-sm", s.cls)} aria-hidden />
              {s.label}
            </span>
            <span className="tabular-nums" dir="ltr">
              {formatCompact(s.value, locale)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Top-N breakdown where each row is a horizontal **stacked token bar**
 * (cached input · not-cached input · output), bar length proportional to the
 * row's total tokens. Used for "LLM calls by model" / "By agent" — Sentry-style.
 */
export function StackedTokenBreakdown({
  title,
  items,
  empty,
  labels,
}: {
  title: string;
  items: InsightsBreakdown[];
  empty: string;
  labels: { cached: string; notCached: string; output: string };
}) {
  const locale = useLocale();
  const seg = (it: InsightsBreakdown) => {
    const cached = it.cached_input_tokens;
    const notCached = Math.max(0, it.input_tokens - cached);
    const output = it.output_tokens;
    const total = it.total_tokens || cached + notCached + output;
    return { cached, notCached, output, total };
  };
  const max = Math.max(1, ...items.map((it) => seg(it).total));
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="text-sm font-semibold">{title}</span>
        <TokenLegend labels={labels} />
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((it) => {
            const s = seg(it);
            const parts = [
              { key: "cached", value: s.cached, label: labels.cached, cls: "bg-accent/40" },
              { key: "notCached", value: s.notCached, label: labels.notCached, cls: "bg-accent" },
              { key: "output", value: s.output, label: labels.output, cls: "bg-success" },
            ];
            return (
              <li key={it.key} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate font-mono" dir="ltr" title={it.key}>
                    {it.key}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground" dir="ltr">
                    {formatCompact(s.total, locale)} · {formatNumber(it.count, locale)}×
                  </span>
                </div>
                <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="flex h-full" style={{ width: `${(s.total / max) * 100}%` }}>
                    {parts.map((p) => (
                      <div
                        key={p.key}
                        className={p.cls}
                        style={{ width: `${s.total > 0 ? (p.value / s.total) * 100 : 0}%` }}
                        title={`${p.label}: ${formatNumber(p.value, locale)}`}
                        aria-hidden
                      />
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

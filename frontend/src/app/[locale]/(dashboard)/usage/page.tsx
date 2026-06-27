"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { EmptyState, PageHeader } from "@/components/dashboard/PageHeader";
import { useOrg } from "@/components/providers/OrgProvider";
import { Card } from "@/components/ui/Card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { api } from "@/lib/api";
import { formatDayKey, formatMonthKey } from "@/lib/datetime";
import { cn, formatNumber, formatToman, localizeDigits } from "@/lib/utils";

export default function UsagePage() {
  const t = useTranslations("dashboard.usage");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { currentOrg } = useOrg();

  const { data, isError, isLoading } = useQuery({
    queryKey: ["usage", currentOrg?.id],
    queryFn: () => api.orgs.usage(currentOrg!.id),
    enabled: !!currentOrg?.id,
    retry: false,
  });

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="p-5 sm:p-8">
        {isLoading ? (
          <div className="h-64 animate-shimmer rounded-[var(--radius)]" />
        ) : isError || !data ? (
          <EmptyState icon={<BarChart3 className="h-8 w-8" />} message={t("unavailable")} />
        ) : (
          <UsageContent data={data} t={t} tc={tc} locale={locale} />
        )}
      </div>
    </div>
  );
}

function UsageContent({
  data,
  t,
  tc,
  locale,
}: {
  data: NonNullable<Awaited<ReturnType<typeof api.orgs.usage>>>;
  t: ReturnType<typeof useTranslations>;
  tc: ReturnType<typeof useTranslations>;
  locale: string;
}) {
  const consumed = data.events_consumed ?? 0;
  const unlimited = data.quota == null || data.quota <= 0;
  const quota = data.quota ?? 0;
  const pct = !unlimited && quota > 0 ? Math.min(100, Math.round((consumed / quota) * 100)) : 0;
  const quotaLabel = unlimited ? "∞" : formatNumber(quota, locale);
  const remainingLabel = unlimited ? "∞" : formatNumber(Math.max(0, quota - consumed), locale);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <div className="text-sm text-muted-foreground">{t("consumed")}</div>
          <div className="mt-2 text-3xl font-bold tabular-nums">
            {formatNumber(consumed, locale)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {unlimited ? t("unlimited") : t("ofQuota", { percent: formatNumber(pct, locale) })}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-sm text-muted-foreground">{t("quota")}</div>
          <div className="mt-2 text-3xl font-bold tabular-nums">{quotaLabel}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t("remaining", { count: remainingLabel })}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-sm text-muted-foreground">{t("overage")}</div>
          <div className="mt-2 text-3xl font-bold tabular-nums text-accent">
            {formatToman(data.overage_cost_toman, locale)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{tc("toman")}</div>
        </Card>
      </div>

      {/* Quota bar */}
      <Card className="p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">{t("period")}</span>
          <span className="text-muted-foreground tabular-nums">
            {formatNumber(consumed, locale)} / {quotaLabel}
          </span>
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              pct >= 90 ? "bg-danger" : "bg-accent"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </Card>

      <UsageBreakdown data={data} t={t} locale={locale} />
    </div>
  );
}

function UsageBreakdown({
  data,
  t,
  locale,
}: {
  data: NonNullable<Awaited<ReturnType<typeof api.orgs.usage>>>;
  t: ReturnType<typeof useTranslations>;
  locale: string;
}) {
  const [mode, setMode] = React.useState<"day" | "month">("day");
  const [hover, setHover] = React.useState<number | null>(null);
  const byDay = data.by_day ?? [];
  const byMonth = data.by_month ?? [];

  const isFa = locale === "fa";
  const rows =
    mode === "day"
      ? byDay.map((d) => ({
          key: d.date,
          display: formatDayKey(d.date, locale),
          short: localizeDigits(Number(d.date.split("-")[2]), locale),
          events: d.events,
        }))
      : byMonth.map((m) => ({
          key: m.period,
          display: formatMonthKey(m.period, locale),
          short: formatMonthKey(m.period, locale),
          events: m.events,
        }));
  const max = Math.max(1, ...rows.map((r) => r.events));

  // Evenly-spaced X-axis ticks (the hover tooltip gives the exact per-bar value).
  const tickCount = Math.min(6, rows.length);
  const ticks =
    tickCount <= 1
      ? [0]
      : [
          ...new Set(
            Array.from({ length: tickCount }, (_, k) =>
              Math.round((k * (rows.length - 1)) / (tickCount - 1))
            )
          ),
        ];

  if (byDay.length === 0 && byMonth.length === 0) return null;

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("breakdown")}</h3>
        <Tabs
          value={mode}
          onValueChange={(v) => setMode(v as "day" | "month")}
          items={[
            { value: "day", label: t("daily") },
            { value: "month", label: t("monthly") },
          ]}
        />
      </div>

      {/* Bar chart with axes */}
      <div className="flex gap-2">
        {/* Y axis */}
        <div className="flex h-40 w-9 shrink-0 flex-col justify-between text-end text-[10px] tabular-nums text-muted-foreground">
          <span>{formatNumber(max, locale)}</span>
          <span>{formatNumber(Math.round(max / 2), locale)}</span>
          <span>{localizeDigits(0, locale)}</span>
        </div>

        {/* Plot area */}
        <div className="relative min-w-0 flex-1">
          {/* Gridlines */}
          <div className="pointer-events-none absolute inset-0 flex h-40 flex-col justify-between">
            <div className="border-t border-border/60" />
            <div className="border-t border-border/40" />
            <div className="border-t border-border" />
          </div>

          {/* Bars */}
          <div className="relative flex h-40 items-end gap-1">
            {rows.map((r, i) => (
              <div
                key={r.key}
                role="img"
                aria-label={`${r.display}: ${formatNumber(r.events, locale)}`}
                className="flex h-full flex-1 cursor-default flex-col items-center justify-end"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              >
                <div
                  className={cn(
                    "w-full rounded-t-sm transition-colors",
                    hover === i ? "bg-accent" : "bg-accent/70"
                  )}
                  style={{ height: `${Math.max(2, (r.events / max) * 100)}%` }}
                />
              </div>
            ))}
          </div>

          {/* Hover tooltip */}
          {hover != null && rows[hover] && (
            <div
              className="pointer-events-none absolute bottom-full z-20 mb-1 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] border border-border bg-card px-2 py-1 text-[11px] shadow-md"
              style={{ insetInlineStart: `${((hover + 0.5) / rows.length) * 100}%` }}
            >
              <span className="font-medium">{rows[hover].display}</span>
              <span dir="ltr" className="tabular-nums text-muted-foreground">
                {formatNumber(rows[hover].events, locale)}
              </span>
            </div>
          )}

          {/* X axis ticks */}
          <div className="relative mt-1.5 h-3 text-[10px] text-muted-foreground">
            {ticks.map((i) => (
              <span
                key={i}
                className={cn("absolute -translate-x-1/2 whitespace-nowrap", !isFa && "font-mono")}
                style={{ insetInlineStart: `${((i + 0.5) / rows.length) * 100}%` }}
              >
                {rows[i]?.short}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="mt-5 max-h-72 overflow-y-auto">
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>{mode === "day" ? t("tableDate") : t("tableMonth")}</TH>
              <TH className="text-end">{t("tableEvents")}</TH>
            </TR>
          </THead>
          <TBody>
            {[...rows].reverse().map((r) => (
              <TR key={r.key}>
                <TD className={cn(!isFa && "font-mono text-xs")} dir={isFa ? undefined : "ltr"}>
                  {r.display}
                </TD>
                <TD className="text-end tabular-nums">{formatNumber(r.events, locale)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </Card>
  );
}

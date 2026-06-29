"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { SpanWaterfall } from "@/components/dashboard/SpanWaterfall";
import { useProjects } from "@/components/providers/ProjectProvider";
import { Badge, LevelBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Input";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Link } from "@/i18n/routing";
import { api } from "@/lib/api";
import type { TransactionGroupDetail } from "@/lib/types";
import {
  cn,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRate,
  localizeDigits,
} from "@/lib/utils";
import { enumParam, useQueryState } from "@/lib/useQueryState";

const PERIODS = ["1h", "24h", "7d", "14d", "30d"] as const;

export default function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  const t = useTranslations("dashboard.transactionDetail");
  const tp = useTranslations("dashboard.performance.periods");
  const tl = useTranslations("dashboard.issues.level");
  const locale = useLocale();
  const { currentProject } = useProjects();
  const projectId = currentProject?.id;

  const [period, setPeriod] = useQueryState("period", enumParam(PERIODS, "24h"));
  const [selected, setSelected] = React.useState<string | null>(null);

  const { data: group, isLoading } = useQuery({
    queryKey: ["transaction-group", projectId, id, period],
    queryFn: () => api.performance.get(currentProject!.id, id, { stats_period: period }),
    enabled: !!projectId,
  });

  const { data: txn } = useQuery({
    queryKey: ["transaction", projectId, selected],
    queryFn: () => api.performance.transaction(currentProject!.id, selected as string),
    enabled: !!projectId && !!selected,
  });

  if (isLoading || !group) {
    return (
      <div className="space-y-4 p-5 sm:p-8">
        <div className="h-8 w-2/3 animate-shimmer rounded-md" />
        <div className="h-40 animate-shimmer rounded-[var(--radius)]" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="border-b border-border px-5 py-5 sm:px-8">
        <Link
          href="/performance"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          {t("back")}
        </Link>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {group.op && (
              <Badge variant="muted" className="font-mono">
                {group.op}
              </Badge>
            )}
            <h1 className="mt-2 break-all text-2xl font-bold tracking-tight" dir="ltr">
              {group.name}
            </h1>
          </div>
          <Select
            value={period}
            onChange={(e) => setPeriod(e.target.value as (typeof PERIODS)[number])}
            className="sm:w-44"
            aria-label={t("period")}
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {tp(p)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="space-y-6 p-5 sm:p-8">
        {/* Summary metrics */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label={t("tpm")} value={formatRate(group.tpm, locale)} />
          <Metric label={t("count")} value={formatNumber(group.count, locale)} />
          <Metric label="p50" value={formatDuration(group.p50, locale)} />
          <Metric label="p95" value={formatDuration(group.p95, locale)} />
          <Metric label="p99" value={formatDuration(group.p99, locale)} />
          <Metric
            label={t("failureRate")}
            value={formatPercent(group.failure_rate, locale)}
            danger={group.failure_rate >= 0.05}
          />
        </div>

        {group.count === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">{t("noData")}</Card>
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-2">
              <SpanBreakdown group={group} locale={locale} t={t} />
              <DurationHistogram group={group} locale={locale} t={t} />
            </div>

            {/* Recent samples */}
            <Card className="overflow-hidden">
              <div className="border-b border-border px-5 py-4">
                <h2 className="font-semibold">{t("samples")}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("samplesHint")}</p>
              </div>
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH className="text-end">{t("duration")}</TH>
                    <TH>{t("status")}</TH>
                    <TH className="hidden sm:table-cell">{t("trace")}</TH>
                    <TH className="text-end">{t("when")}</TH>
                  </TR>
                </THead>
                <TBody>
                  {group.samples.map((s) => (
                    <TR
                      key={s.event_id}
                      className={cn(
                        "cursor-pointer",
                        selected === s.event_id && "bg-accent-soft/40"
                      )}
                      onClick={() => setSelected(s.event_id)}
                    >
                      <TD className="text-end tabular-nums">
                        {formatDuration(s.duration_ms, locale)}
                      </TD>
                      <TD>
                        <Badge variant={s.is_failed ? "danger" : "success"}>
                          {s.is_failed ? t("failed") : s.status || "ok"}
                        </Badge>
                      </TD>
                      <TD className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
                        {s.trace_id ? s.trace_id.slice(0, 16) : "—"}
                      </TD>
                      <TD className="whitespace-nowrap text-end text-muted-foreground">
                        <RelativeTime date={s.timestamp} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>

            {/* Waterfall for the selected sample */}
            {selected && txn && (
              <Card className="p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-semibold">{t("waterfall")}</h2>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {formatDuration(txn.duration_ms, locale)}
                  </span>
                </div>

                {txn.issues.length > 0 && (
                  <div className="mb-4 rounded-[var(--radius)] border border-danger/30 bg-danger/5 p-3">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("attachedIssues")}
                    </h3>
                    <ul className="space-y-1.5">
                      {txn.issues.map((iss) => (
                        <li key={iss.id}>
                          <Link
                            href={`/issues/${iss.id}`}
                            className="flex min-w-0 items-center gap-2 text-sm hover:underline"
                          >
                            <LevelBadge level={iss.level} label={tl(iss.level)} />
                            <span className="truncate font-medium">{iss.title}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <SpanWaterfall
                  spans={txn.spans}
                  total={txn.duration_ms}
                  rootSpanId={txn.span_id}
                  truncated={txn.spans_truncated}
                  spanCount={txn.span_count}
                />
              </Card>
            )}
          </>
        )}

        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          {t("firstSeen")}: <RelativeTime date={group.first_seen} />
        </p>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  mono,
  danger,
}: {
  label: string;
  value: string;
  mono?: boolean;
  danger?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1.5 text-xl font-bold tabular-nums",
          mono && "font-mono",
          danger && "text-danger"
        )}
      >
        {value}
      </div>
    </Card>
  );
}

function SpanBreakdown({
  group,
  locale,
  t,
}: {
  group: TransactionGroupDetail;
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const max = Math.max(1, ...group.breakdown.map((b) => b.total_ms));
  return (
    <Card className="p-5">
      <h2 className="mb-4 font-semibold">{t("breakdown")}</h2>
      {group.breakdown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noSpans")}</p>
      ) : (
        <div className="space-y-2.5">
          {group.breakdown.slice(0, 10).map((b) => (
            <div key={b.op} className="text-xs">
              <div className="flex items-center justify-between">
                <span className="font-mono font-medium">{b.op}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatDuration(b.avg_ms, locale)} · {formatNumber(b.count, locale)}×
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-accent/70"
                  style={{ width: `${(b.total_ms / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function DurationHistogram({
  group,
  locale,
  t,
}: {
  group: TransactionGroupDetail;
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const bins = group.histogram;
  const max = Math.max(1, ...bins.map((b) => b.count));
  const [hover, setHover] = React.useState<number | null>(null);

  const tickCount = Math.min(5, bins.length);
  const ticks =
    tickCount <= 1
      ? [0]
      : [
          ...new Set(
            Array.from({ length: tickCount }, (_, k) =>
              Math.round((k * (bins.length - 1)) / (tickCount - 1))
            )
          ),
        ];

  return (
    <Card className="p-5">
      <h2 className="mb-4 font-semibold">{t("distribution")}</h2>
      {bins.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noData")}</p>
      ) : (
        <div className="flex gap-2">
          {/* Y axis (count) */}
          <div className="flex h-32 w-8 shrink-0 flex-col justify-between text-end text-[10px] tabular-nums text-muted-foreground">
            <span>{formatNumber(max, locale)}</span>
            <span>{formatNumber(Math.round(max / 2), locale)}</span>
            <span>{localizeDigits(0, locale)}</span>
          </div>

          {/* Plot — duration axis is always LTR */}
          <div className="relative min-w-0 flex-1" dir="ltr">
            <div className="pointer-events-none absolute inset-0 flex h-32 flex-col justify-between">
              <div className="border-t border-border/60" />
              <div className="border-t border-border/40" />
              <div className="border-t border-border" />
            </div>

            <div className="relative flex h-32 items-end gap-px">
              {bins.map((b, i) => (
                <div
                  key={b.start}
                  role="img"
                  aria-label={`${formatDuration(b.start, locale)}–${formatDuration(b.end, locale)}: ${formatNumber(b.count, locale)}`}
                  className="flex h-full flex-1 cursor-default items-end"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                >
                  <div
                    className={cn(
                      "w-full rounded-t-sm transition-colors",
                      hover === i ? "bg-accent" : "bg-accent/60"
                    )}
                    style={{ height: `${Math.max(2, (b.count / max) * 100)}%` }}
                  />
                </div>
              ))}
            </div>

            {hover != null && bins[hover] && (
              <div
                className="pointer-events-none absolute bottom-full z-20 mb-1 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] border border-border bg-card px-2 py-1 text-[11px] shadow-md"
                style={{ insetInlineStart: `${((hover + 0.5) / bins.length) * 100}%` }}
              >
                <span className="font-medium tabular-nums">
                  {formatDuration(bins[hover].start, locale)}–
                  {formatDuration(bins[hover].end, locale)}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatNumber(bins[hover].count, locale)}
                </span>
              </div>
            )}

            {/* X axis (duration ticks) */}
            <div className="relative mt-1.5 h-3 text-[10px] tabular-nums text-muted-foreground">
              {ticks.map((i) => (
                <span
                  key={i}
                  className="absolute -translate-x-1/2 whitespace-nowrap"
                  style={{ insetInlineStart: `${((i + 0.5) / bins.length) * 100}%` }}
                >
                  {formatDuration(bins[i]?.start ?? 0, locale)}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

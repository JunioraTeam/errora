"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ScrollText, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { EmptyState, PageHeader } from "@/components/dashboard/PageHeader";
import { ProjectSwitcher } from "@/components/dashboard/ProjectSwitcher";
import { useProjects } from "@/components/providers/ProjectProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Input, Select } from "@/components/ui/Input";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { LOG_LEVELS, type LogEntry, type LogLevel } from "@/lib/types";
import { cn, localizeDigits } from "@/lib/utils";
import { enumParam, numberParam, setParam, stringParam, useQueryState } from "@/lib/useQueryState";

const PAGE_SIZE = 50;
const PERIODS = ["1h", "24h", "7d", "14d", "30d"] as const;

// Each log level maps to a shared severity colour token (trace reuses debug,
// warn reuses warning — Errora's palette only defines the five issue levels).
const LEVEL_COLOR: Record<LogLevel, string> = {
  trace: "bg-[var(--level-debug)]/15 text-[var(--level-debug)]",
  debug: "bg-[var(--level-debug)]/15 text-[var(--level-debug)]",
  info: "bg-[var(--level-info)]/15 text-[var(--level-info)]",
  warn: "bg-[var(--level-warning)]/15 text-[var(--level-warning)]",
  error: "bg-[var(--level-error)]/15 text-[var(--level-error)]",
  fatal: "bg-[var(--level-fatal)]/15 text-[var(--level-fatal)]",
};

function LogLevelBadge({ level, label }: { level: LogLevel | ""; label: string }) {
  const cls = level ? LEVEL_COLOR[level] : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase",
        cls
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function attrEntries(attrs: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(attrs).map(([k, v]) => [
    k,
    typeof v === "object" ? JSON.stringify(v) : String(v),
  ]);
}

export default function LogsPage() {
  const t = useTranslations("dashboard.logs");
  const tcol = useTranslations("dashboard.logs.columns");
  const tlevel = useTranslations("dashboard.logs.levels");
  const tp = useTranslations("dashboard.performance.periods");
  const locale = useLocale();
  const { currentProject } = useProjects();
  const projectId = currentProject?.id;

  const [search, setSearch] = useQueryState("q", stringParam());
  const [debounced, setDebounced] = React.useState(search);
  const [period, setPeriod] = useQueryState("period", enumParam(PERIODS, "24h"));
  const [levels, setLevels] = useQueryState("level", setParam(LOG_LEVELS));
  const [offset, setOffset] = useQueryState("offset", numberParam());
  const [selected, setSelected] = React.useState<LogEntry | null>(null);

  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const levelParam = [...levels].join(",");

  // Reset paging on filter change, but not on first mount (keeps a URL offset).
  const mounted = React.useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally resets paging on filter change
  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setOffset(0);
  }, [debounced, period, levelParam, projectId]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["logs", projectId, debounced, period, levelParam, offset],
    queryFn: () =>
      api.logs.list(currentProject!.id, {
        q: debounced || undefined,
        level: levelParam || undefined,
        stats_period: period,
        limit: PAGE_SIZE,
        offset,
      }),
    enabled: !!projectId,
  });

  const rows = data?.results ?? [];
  const total = data?.count ?? 0;
  const facets = data?.facets.level;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  function toggleLevel(lvl: LogLevel) {
    const next = new Set(levels);
    if (next.has(lvl)) next.delete(lvl);
    else next.add(lvl);
    setLevels(next);
  }

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} action={<ProjectSwitcher />} />

      <div className="space-y-4 p-5 sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="ps-9"
              dir="ltr"
            />
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

        {/* Level facet chips — click to toggle; counts reflect the active query. */}
        <div className="flex flex-wrap gap-2">
          {LOG_LEVELS.map((lvl) => {
            const active = levels.has(lvl);
            const count = facets?.[lvl] ?? 0;
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => toggleLevel(lvl)}
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border text-muted-foreground hover:bg-muted"
                )}
              >
                <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", LEVEL_COLOR[lvl])} />
                {tlevel(lvl)}
                <span className="tabular-nums opacity-70">{localizeDigits(count, locale)}</span>
              </button>
            );
          })}
        </div>

        <Card className="overflow-hidden">
          {isLoading ? (
            <div className="space-y-px p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 animate-shimmer rounded-md" />
              ))}
            </div>
          ) : isError || !currentProject || rows.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<ScrollText className="h-8 w-8" />} message={t("empty")} />
            </div>
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH className="w-px whitespace-nowrap">{tcol("time")}</TH>
                  <TH className="w-px">{tcol("level")}</TH>
                  <TH>{tcol("message")}</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((log) => (
                  <TR
                    key={log.id}
                    className="cursor-pointer align-top"
                    onClick={() => setSelected(log)}
                  >
                    <TD className="whitespace-nowrap text-muted-foreground">
                      <RelativeTime date={log.timestamp} />
                    </TD>
                    <TD>
                      <LogLevelBadge level={log.level} label={tlevel(log.level || "info")} />
                    </TD>
                    <TD>
                      <span className="block truncate font-mono text-sm" dir="ltr">
                        {log.body}
                      </span>
                      {Object.keys(log.attributes).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1" dir="ltr">
                          {attrEntries(log.attributes)
                            .slice(0, 4)
                            .map(([k, v]) => (
                              <span
                                key={k}
                                className="inline-flex max-w-[16rem] items-center gap-1 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                              >
                                <span className="font-medium text-foreground/70">{k}</span>
                                <span className="truncate">{v}</span>
                              </span>
                            ))}
                        </div>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        {!isLoading && total > 0 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span className="tabular-nums">
              {t("pagination", {
                from: localizeDigits(from, locale),
                to: localizeDigits(to, locale),
                total: localizeDigits(total, locale),
              })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
                {t("prev")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                {t("next")}
                <ChevronRight className="h-4 w-4 rtl:rotate-180" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <LogDetail log={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function LogDetail({ log, onClose }: { log: LogEntry | null; onClose: () => void }) {
  const t = useTranslations("dashboard.logs");
  const tlevel = useTranslations("dashboard.logs.levels");
  const locale = useLocale();
  const attrs = log ? attrEntries(log.attributes) : [];

  return (
    <Dialog open={!!log} onClose={onClose} title={t("detailTitle")} className="max-w-2xl">
      {log && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <LogLevelBadge level={log.level} label={tlevel(log.level || "info")} />
            <span className="text-xs text-muted-foreground" dir="ltr">
              {formatDateTime(log.timestamp, locale)}
            </span>
          </div>

          <p
            className="rounded-[var(--radius)] border border-border bg-muted/20 p-3 font-mono text-sm"
            dir="ltr"
          >
            {log.body}
          </p>

          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {log.environment && <Field k={t("environment")} v={log.environment} />}
            {log.release && <Field k={t("release")} v={log.release} mono />}
            {log.trace_id && <Field k={t("trace")} v={log.trace_id} mono />}
            {log.span_id && <Field k={t("span")} v={log.span_id} mono />}
          </dl>

          {attrs.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("attributes")}
              </h4>
              <div className="overflow-hidden rounded-[var(--radius-sm)] border border-border">
                <table className="w-full text-xs" dir="ltr">
                  <tbody className="divide-y divide-border">
                    {attrs.map(([k, v]) => (
                      <tr key={k}>
                        <td className="whitespace-nowrap bg-muted/40 px-3 py-1.5 font-mono font-medium">
                          {k}
                        </td>
                        <td className="break-all px-3 py-1.5 font-mono text-muted-foreground">
                          {v}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-0.5">
      <dt className="shrink-0 text-muted-foreground">{k}</dt>
      <dd
        className={cn("min-w-0 truncate text-end", mono && "font-mono text-xs")}
        dir={mono ? "ltr" : undefined}
        title={v}
      >
        {v}
      </dd>
    </div>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, Gauge, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { EmptyState, PageHeader } from "@/components/dashboard/PageHeader";
import { ProjectSwitcher } from "@/components/dashboard/ProjectSwitcher";
import { useProjects } from "@/components/providers/ProjectProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Input";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { useRouter } from "@/i18n/routing";
import { api } from "@/lib/api";
import { cn, formatDuration, formatPercent, formatRate, localizeDigits } from "@/lib/utils";

const PAGE_SIZE = 50;
const PERIODS = ["1h", "24h", "7d", "14d", "30d"] as const;
type SortKey = "name" | "tpm" | "p50" | "p95" | "failure_rate" | "last_seen";
type Order = "asc" | "desc";

export default function PerformancePage() {
  const t = useTranslations("dashboard.performance");
  const tcol = useTranslations("dashboard.performance.columns");
  const tp = useTranslations("dashboard.performance.periods");
  const locale = useLocale();
  const router = useRouter();
  const { currentProject } = useProjects();
  const projectId = currentProject?.id;

  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [period, setPeriod] = React.useState<(typeof PERIODS)[number]>("24h");
  const [sort, setSort] = React.useState<SortKey>("last_seen");
  const [order, setOrder] = React.useState<Order>("desc");
  const [offset, setOffset] = React.useState(0);

  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally resets paging on filter change
  React.useEffect(() => setOffset(0), [debounced, period, sort, order, projectId]);

  // Click a column: sort by it (desc first); click the active column to flip.
  function toggleSort(key: SortKey) {
    if (sort === key) setOrder((o) => (o === "desc" ? "asc" : "desc"));
    else {
      setSort(key);
      setOrder("desc");
    }
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ["transactions", projectId, debounced, period, sort, order, offset],
    queryFn: () =>
      api.performance.list(currentProject!.id, {
        q: debounced || undefined,
        stats_period: period,
        sort,
        order,
        limit: PAGE_SIZE,
        offset,
      }),
    enabled: !!projectId,
  });

  const groups = data?.results ?? [];
  const total = data?.count ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  const sortProps = { sort, order, onToggle: toggleSort };

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

        <Card className="overflow-hidden">
          {isLoading ? (
            <div className="space-y-px p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-12 animate-shimmer rounded-md" />
              ))}
            </div>
          ) : isError || !currentProject || groups.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<Gauge className="h-8 w-8" />} message={t("empty")} />
            </div>
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <SortableTH label={tcol("transaction")} sortKey="name" {...sortProps} />
                  <SortableTH label={tcol("tpm")} sortKey="tpm" align="end" {...sortProps} />
                  <SortableTH
                    label={tcol("p50")}
                    sortKey="p50"
                    align="end"
                    className="hidden sm:table-cell"
                    {...sortProps}
                  />
                  <SortableTH label={tcol("p95")} sortKey="p95" align="end" {...sortProps} />
                  <SortableTH
                    label={tcol("failureRate")}
                    sortKey="failure_rate"
                    align="end"
                    {...sortProps}
                  />
                  <SortableTH
                    label={tcol("lastSeen")}
                    sortKey="last_seen"
                    align="end"
                    className="hidden md:table-cell"
                    {...sortProps}
                  />
                </TR>
              </THead>
              <TBody>
                {groups.map((g) => (
                  <TR
                    key={g.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/performance/${g.id}`)}
                  >
                    <TD>
                      <div className="block min-w-0">
                        <div className="flex items-center gap-2">
                          {g.op && (
                            <Badge variant="muted" className="font-mono">
                              {g.op}
                            </Badge>
                          )}
                        </div>
                        <span className="mt-1 block truncate font-medium" dir="ltr">
                          {g.name}
                        </span>
                      </div>
                    </TD>
                    <TD className="text-end tabular-nums text-muted-foreground">
                      {formatRate(g.tpm, locale)}
                    </TD>
                    <TD className="hidden text-end tabular-nums sm:table-cell">
                      {formatDuration(g.p50, locale)}
                    </TD>
                    <TD className="text-end tabular-nums">{formatDuration(g.p95, locale)}</TD>
                    <TD className="text-end tabular-nums">
                      <span
                        className={cn(
                          g.failure_rate >= 0.05
                            ? "font-medium text-danger"
                            : "text-muted-foreground"
                        )}
                      >
                        {formatPercent(g.failure_rate, locale)}
                      </span>
                    </TD>
                    <TD className="hidden whitespace-nowrap text-end text-muted-foreground md:table-cell">
                      <RelativeTime date={g.last_seen} />
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
    </div>
  );
}

function SortableTH({
  label,
  sortKey,
  sort,
  order,
  onToggle,
  align,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortKey;
  order: Order;
  onToggle: (key: SortKey) => void;
  align?: "end";
  className?: string;
}) {
  const active = sort === sortKey;
  return (
    <TH
      className={cn(align === "end" && "text-end", className)}
      aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-foreground",
          align === "end" && "flex-row-reverse",
          active ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
        {active ? (
          <ChevronUp
            className={cn("h-3.5 w-3.5 transition-transform", order === "desc" && "rotate-180")}
          />
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
        )}
      </button>
    </TH>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coins,
  Cpu,
  Server,
  Users,
  Wrench,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { BarChart, StackedBarChart } from "@/components/dashboard/insights/BarChart";
import {
  BreakdownList,
  StackedTokenBreakdown,
  StatTile,
  TokenBar,
} from "@/components/dashboard/insights/Widgets";
import { EmptyState, PageHeader } from "@/components/dashboard/PageHeader";
import { ProjectSwitcher } from "@/components/dashboard/ProjectSwitcher";
import { useProjects } from "@/components/providers/ProjectProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DatePicker } from "@/components/ui/DatePicker";
import { Input, Select } from "@/components/ui/Input";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { useRouter } from "@/i18n/routing";
import { api } from "@/lib/api";
import { toISODate } from "@/lib/datetime";
import type { AgentRunListResponse, InsightsBreakdown } from "@/lib/types";
import { cn, formatCompact, formatDuration, formatNumber, localizeDigits } from "@/lib/utils";
import { enumParam, numberParam, stringParam, useQueryState } from "@/lib/useQueryState";

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

const PERIODS = ["1h", "24h", "7d", "14d", "30d"] as const;
const RUNS_PAGE_SIZE = 25;
type Tab = "agents" | "mcp";

const tokenLabels = (t: Tt) => ({
  cached: t("stats.cached"),
  notCached: t("stats.notCached"),
  output: t("stats.outputTokens"),
});

export default function InsightsPage() {
  const t = useTranslations("dashboard.insights");
  const tp = useTranslations("dashboard.performance.periods");
  const router = useRouter();
  const locale = useLocale();
  const { currentProject } = useProjects();
  const projectId = currentProject?.id;

  const [tab, setTab] = useQueryState<Tab>("tab", enumParam(["agents", "mcp"], "agents"));
  const [period, setPeriod] = useQueryState("period", stringParam("24h"));
  // Custom range: date (Gregorian ISO from the Jalali-aware DatePicker) + time.
  const [startDate, setStartDate] = useQueryState("from", stringParam());
  const [startTime, setStartTime] = useQueryState("fromTime", stringParam("00:00"));
  const [endDate, setEndDate] = useQueryState("to", stringParam());
  const [endTime, setEndTime] = useQueryState("toTime", stringParam("23:59"));
  const [runsOffset, setRunsOffset] = useQueryState("offset", numberParam());

  const custom = period === "custom";
  // Either an explicit start/end range (custom) or a relative stats_period preset.
  const range = React.useMemo(() => {
    if (custom && startDate && endDate) {
      const s = new Date(`${startDate}T${startTime || "00:00"}:00`);
      const e = new Date(`${endDate}T${endTime || "23:59"}:00`);
      return { start: s.toISOString(), end: e.toISOString() };
    }
    return { stats_period: custom ? "24h" : period };
  }, [custom, startDate, startTime, endDate, endTime, period]);
  const rangeKey = JSON.stringify(range);

  // Reset paging when the window/project changes, but not on first mount
  // (keeps an offset restored from the URL).
  const mounted = React.useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset paging when the window/project changes
  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setRunsOffset(0);
  }, [rangeKey, projectId]);

  const agents = useQuery({
    queryKey: ["insights-agents", projectId, rangeKey],
    queryFn: () => api.insights.agents(currentProject!.id, range),
    enabled: !!projectId && tab === "agents",
  });
  const runs = useQuery({
    queryKey: ["insights-runs", projectId, rangeKey, runsOffset],
    queryFn: () =>
      api.insights.runs(currentProject!.id, {
        ...range,
        limit: RUNS_PAGE_SIZE,
        offset: runsOffset,
      }),
    enabled: !!projectId && tab === "agents",
  });
  const mcp = useQuery({
    queryKey: ["insights-mcp", projectId, rangeKey],
    queryFn: () => api.insights.mcp(currentProject!.id, range),
    enabled: !!projectId && tab === "mcp",
  });

  const num = (n: number) => formatNumber(n, locale);
  const compact = (n: number) => formatCompact(n, locale);
  const dur = (ms: number | null | undefined) => formatDuration(ms ?? null, locale);

  // Switching to "Custom range" prefills the pickers with the last 24h so the
  // dashboard stays on real data (instead of silently falling back to a preset).
  function selectPeriod(value: string) {
    if (value === "custom" && !startDate && !endDate) {
      const now = new Date();
      const past = new Date(now.getTime() - 24 * 3600 * 1000);
      setStartDate(toISODate(past));
      setStartTime(hhmm(past));
      setEndDate(toISODate(now));
      setEndTime(hhmm(now));
    }
    setPeriod(value);
  }

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} action={<ProjectSwitcher />} />

      <div className="space-y-5 p-5 sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-1 rounded-[var(--radius-sm)] bg-muted p-1">
            {(["agents", "mcp"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium transition-colors",
                  tab === key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t(`tabs.${key}`)}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {custom && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <DateTimeField
                  date={startDate}
                  time={startTime}
                  onDate={setStartDate}
                  onTime={setStartTime}
                  label={t("startDate")}
                />
                <span className="hidden text-muted-foreground sm:inline">→</span>
                <DateTimeField
                  date={endDate}
                  time={endTime}
                  onDate={setEndDate}
                  onTime={setEndTime}
                  label={t("endDate")}
                />
              </div>
            )}
            <Select
              value={period}
              onChange={(e) => selectPeriod(e.target.value)}
              className="sm:w-44"
              aria-label={t("period")}
            >
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {tp(p)}
                </option>
              ))}
              <option value="custom">{t("periods.custom")}</option>
            </Select>
          </div>
        </div>

        {tab === "agents" ? (
          <AgentsTab
            data={agents.data}
            runsData={runs.data}
            offset={runsOffset}
            onPage={setRunsOffset}
            loading={agents.isLoading}
            isError={agents.isError}
            hasProject={!!currentProject}
            onOpenRun={(traceId) => router.push(`/insights/runs/${traceId}`)}
            t={t}
            num={num}
            compact={compact}
            dur={dur}
          />
        ) : (
          <McpTab
            data={mcp.data}
            loading={mcp.isLoading}
            isError={mcp.isError}
            hasProject={!!currentProject}
            t={t}
            num={num}
          />
        )}
      </div>
    </div>
  );
}

type Tt = ReturnType<typeof useTranslations>;
type Fmt = (n: number) => string;
type DurFmt = (ms: number | null | undefined) => string;

function SkeletonGrid() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-24 animate-shimmer rounded-[var(--radius)]" />
      ))}
    </div>
  );
}

function AgentsTab({
  data,
  runsData,
  offset,
  onPage,
  loading,
  isError,
  hasProject,
  onOpenRun,
  t,
  num,
  compact,
  dur,
}: {
  data: import("@/lib/types").AgentsOverview | undefined;
  runsData: AgentRunListResponse | undefined;
  offset: number;
  onPage: (n: number) => void;
  loading: boolean;
  isError: boolean;
  hasProject: boolean;
  onOpenRun: (traceId: string) => void;
  t: Tt;
  num: Fmt;
  compact: Fmt;
  dur: DurFmt;
}) {
  const locale = useLocale();
  if (loading) return <SkeletonGrid />;
  if (isError) {
    return (
      <Card className="p-5">
        <EmptyState
          icon={<AlertTriangle className="h-8 w-8 text-danger" />}
          message={t("loadError")}
        />
      </Card>
    );
  }
  if (!hasProject || !data || data.totals.agent_runs === 0) {
    return (
      <Card className="p-5">
        <EmptyState icon={<Bot className="h-8 w-8" />} message={t("empty")} />
      </Card>
    );
  }
  const { totals, series } = data;
  const results = runsData?.results ?? [];
  const total = runsData?.count ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + RUNS_PAGE_SIZE, total);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={t("stats.agentRuns")}
          value={num(totals.agent_runs)}
          icon={<Bot className="h-4 w-4" />}
        />
        <StatTile
          label={t("stats.llmCalls")}
          value={num(totals.llm_calls)}
          icon={<Cpu className="h-4 w-4" />}
        />
        <StatTile
          label={t("stats.toolCalls")}
          value={num(totals.tool_calls)}
          icon={<Wrench className="h-4 w-4" />}
        />
        <StatTile
          label={t("stats.errors")}
          value={num(totals.errors)}
          tone={totals.errors > 0 ? "danger" : "default"}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <StatTile
          label={t("stats.totalTokens")}
          value={compact(totals.tokens.total)}
          icon={<Coins className="h-4 w-4" />}
        />
        {totals.tokens.cost_usd > 0 ? (
          <StatTile label={t("stats.cost")} value={`$${totals.tokens.cost_usd.toFixed(4)}`} />
        ) : (
          <StatTile label={t("stats.inputTokens")} value={compact(totals.tokens.input)} />
        )}
        <StatTile label={t("stats.outputTokens")} value={compact(totals.tokens.output)} />
        <StatTile
          label={t("stats.avgDuration")}
          value={dur(totals.duration.avg)}
          icon={<Clock className="h-4 w-4" />}
          sub={`P95 ${dur(totals.duration.p95)}${totals.duration.sampled ? ` · ${t("stats.sampled")}` : ""}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="text-sm font-semibold">{t("sections.runsOverTime")}</div>
          <div className="mt-3">
            <BarChart
              data={series.runs}
              start={series.start}
              widthMinutes={series.width_minutes}
              unit={series.unit}
              label={t("stats.agentRuns")}
            />
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-semibold">{t("sections.tokensOverTime")}</div>
          <div className="mt-3">
            <StackedBarChart
              start={series.start}
              widthMinutes={series.width_minutes}
              unit={series.unit}
              series={[
                { data: series.tokens_input, label: t("stats.inputTokens"), cls: "bg-accent" },
                { data: series.tokens_output, label: t("stats.outputTokens"), cls: "bg-success" },
              ]}
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="text-sm font-semibold">{t("sections.llmCallsOverTime")}</div>
          <div className="mt-3">
            <BarChart
              data={series.llm_calls}
              start={series.start}
              widthMinutes={series.width_minutes}
              unit={series.unit}
              label={t("stats.llmCalls")}
              color="bg-accent"
            />
          </div>
        </Card>
        <TokenBar
          title={t("sections.tokenBreakdown")}
          cached={totals.tokens.cached}
          notCached={totals.tokens.not_cached}
          output={totals.tokens.output}
          labels={{
            cached: t("stats.cached"),
            notCached: t("stats.notCached"),
            output: t("stats.outputTokens"),
          }}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <StackedTokenBreakdown
          title={t("sections.llmByModel")}
          items={data.llm_by_model}
          empty={t("none")}
          labels={tokenLabels(t)}
        />
        <StackedTokenBreakdown
          title={t("sections.byAgent")}
          items={data.by_agent}
          empty={t("none")}
          labels={tokenLabels(t)}
        />
        <BreakdownList
          title={t("sections.byProvider")}
          items={data.by_provider}
          empty={t("none")}
        />
        <BreakdownList
          title={t("sections.mostUsedTools")}
          items={data.top_tools}
          empty={t("none")}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">
          {t("sections.agentRuns")}
        </div>
        {results.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>{t("columns.run")}</TH>
                <TH className="hidden sm:table-cell">{t("columns.model")}</TH>
                <TH className="text-end">{t("columns.llmCalls")}</TH>
                <TH className="text-end">{t("columns.toolCalls")}</TH>
                <TH className="text-end">{t("columns.tokens")}</TH>
                <TH className="text-end">{t("columns.duration")}</TH>
                <TH className="hidden text-end md:table-cell">{t("columns.time")}</TH>
              </TR>
            </THead>
            <TBody>
              {results.map((r) => (
                <TR
                  key={r.trace_id}
                  className="cursor-pointer"
                  onClick={() => onOpenRun(r.trace_id)}
                >
                  <TD>
                    <div className="flex items-center gap-2">
                      {r.is_failed && <Badge variant="danger">!</Badge>}
                      <span className="truncate font-medium" dir="ltr">
                        {r.name || r.trace_id.slice(0, 8)}
                      </span>
                    </div>
                  </TD>
                  <TD
                    className="hidden font-mono text-xs text-muted-foreground sm:table-cell"
                    dir="ltr"
                  >
                    {r.model || "—"}
                  </TD>
                  <TD className="text-end tabular-nums">{num(r.llm_calls)}</TD>
                  <TD className="text-end tabular-nums">{num(r.tool_calls)}</TD>
                  <TD className="text-end tabular-nums" dir="ltr">
                    {compact(r.total_tokens)}
                  </TD>
                  <TD className="text-end tabular-nums">{dur(r.duration_ms)}</TD>
                  <TD className="hidden whitespace-nowrap text-end text-muted-foreground md:table-cell">
                    {r.timestamp && <RelativeTime date={r.timestamp} />}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {total > RUNS_PAGE_SIZE && (
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
              onClick={() => onPage(Math.max(0, offset - RUNS_PAGE_SIZE))}
            >
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
              {t("prev")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + RUNS_PAGE_SIZE >= total}
              onClick={() => onPage(offset + RUNS_PAGE_SIZE)}
            >
              {t("next")}
              <ChevronRight className="h-4 w-4 rtl:rotate-180" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Date (Jalali-aware) + time pair that composes one side of a custom range. */
function DateTimeField({
  date,
  time,
  onDate,
  onTime,
  label,
}: {
  date: string;
  time: string;
  onDate: (iso: string) => void;
  onTime: (hm: string) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <DatePicker value={date} onChange={onDate} ariaLabel={label} className="w-40" />
      <Input
        type="time"
        value={time}
        onChange={(e) => onTime(e.target.value)}
        aria-label={label}
        className="w-28"
      />
    </div>
  );
}

function McpTab({
  data,
  loading,
  isError,
  hasProject,
  t,
  num,
}: {
  data: import("@/lib/types").McpOverview | undefined;
  loading: boolean;
  isError: boolean;
  hasProject: boolean;
  t: Tt;
  num: Fmt;
}) {
  if (loading) return <SkeletonGrid />;
  if (isError) {
    return (
      <Card className="p-5">
        <EmptyState
          icon={<AlertTriangle className="h-8 w-8 text-danger" />}
          message={t("loadError")}
        />
      </Card>
    );
  }
  if (!hasProject || !data || data.totals.requests === 0) {
    return (
      <Card className="p-5">
        <EmptyState icon={<Server className="h-8 w-8" />} message={t("emptyMcp")} />
      </Card>
    );
  }
  const { totals, series } = data;
  const byUsage = (it: InsightsBreakdown) => it.count;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={t("stats.requests")}
          value={num(totals.requests)}
          icon={<Server className="h-4 w-4" />}
        />
        <StatTile
          label={t("stats.clients")}
          value={num(totals.clients)}
          icon={<Users className="h-4 w-4" />}
        />
        <StatTile
          label={t("stats.tools")}
          value={num(totals.tools)}
          icon={<Wrench className="h-4 w-4" />}
        />
        <StatTile
          label={t("stats.errors")}
          value={num(totals.errors)}
          tone={totals.errors > 0 ? "danger" : "default"}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
      </div>

      <Card className="p-4">
        <div className="text-sm font-semibold">{t("sections.mcpTraffic")}</div>
        <div className="mt-3">
          <BarChart
            data={series.requests}
            start={series.start}
            widthMinutes={series.width_minutes}
            unit={series.unit}
            label={t("stats.requests")}
          />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownList
          title={t("sections.trafficByClient")}
          items={data.by_client}
          empty={t("none")}
          getValue={byUsage}
        />
        <BreakdownList
          title={t("sections.byMethod")}
          items={data.by_method}
          empty={t("none")}
          getValue={byUsage}
        />
        <BreakdownList
          title={t("sections.mostUsedTools")}
          items={data.top_tools}
          empty={t("none")}
          getValue={byUsage}
        />
        <BreakdownList
          title={t("sections.mostUsedResources")}
          items={data.top_resources}
          empty={t("none")}
          getValue={byUsage}
        />
        <BreakdownList
          title={t("sections.mostUsedPrompts")}
          items={data.top_prompts}
          empty={t("none")}
          getValue={byUsage}
        />
        <BreakdownList
          title={t("sections.byTransport")}
          items={data.by_transport}
          empty={t("none")}
          getValue={byUsage}
        />
      </div>
    </div>
  );
}

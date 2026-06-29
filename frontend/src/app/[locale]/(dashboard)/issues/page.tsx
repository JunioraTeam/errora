"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bug,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Flag,
  MoreVertical,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { AssignDropdown } from "@/components/dashboard/AssignDropdown";
import { EmptyState, PageHeader } from "@/components/dashboard/PageHeader";
import { ProjectSwitcher } from "@/components/dashboard/ProjectSwitcher";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { useOrg } from "@/components/providers/OrgProvider";
import { useProjects } from "@/components/providers/ProjectProvider";
import { LevelBadge, StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { DatePicker } from "@/components/ui/DatePicker";
import { Input, Select } from "@/components/ui/Input";
import { Popover, PopoverItem } from "@/components/ui/Popover";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Tooltip } from "@/components/ui/Tooltip";
import { useRouter } from "@/i18n/routing";
import { api } from "@/lib/api";
import type { BulkAction, Issue, IssueLevel, IssuePriority, IssueStatus } from "@/lib/types";
import { cn, formatNumber, localizeDigits } from "@/lib/utils";
import { enumParam, numberParam, type Serde, stringParam, useQueryState } from "@/lib/useQueryState";

const PAGE_SIZE = 50;
const TREND_WINDOWS = ["24h", "30d"] as const;
const TREND_BUCKETS: Record<(typeof TREND_WINDOWS)[number], number> = { "24h": 24, "30d": 30 };

const ISSUE_STATUSES: IssueStatus[] = ["unresolved", "resolved", "ignored", "archived"];
const ISSUE_LEVELS: IssueLevel[] = ["fatal", "error", "warning", "info", "debug"];

// Default status is "unresolved" (omitted from the URL); the "all" view has no
// natural empty string, so it is stored under the explicit "all" sentinel.
const statusParam: Serde<IssueStatus | ""> = {
  parse: (raw) =>
    raw === "all" ? "" : ISSUE_STATUSES.includes(raw as IssueStatus) ? (raw as IssueStatus) : "unresolved",
  serialize: (v) => (v === "unresolved" ? null : v === "" ? "all" : v),
};

const PRIORITY_BADGE: Record<IssuePriority, string> = {
  high: "bg-danger/15 text-danger",
  medium: "bg-[var(--level-warning)]/15 text-[var(--level-warning)]",
  low: "bg-muted text-muted-foreground",
};
const PRIORITY_DOT: Record<IssuePriority, string> = {
  high: "bg-danger",
  medium: "bg-[var(--level-warning)]",
  low: "bg-muted-foreground",
};
const PRIORITIES: IssuePriority[] = ["high", "medium", "low"];

export default function IssuesPage() {
  const t = useTranslations("dashboard.issues");
  const ts = useTranslations("dashboard.issues.status");
  const tl = useTranslations("dashboard.issues.level");
  const tcol = useTranslations("dashboard.issues.columns");
  const tpag = useTranslations("dashboard.issues.pagination");
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const { currentProject } = useProjects();
  const { currentOrg } = useOrg();
  const projectId = currentProject?.id;
  const orgId = currentOrg?.id;

  const [status, setStatus] = useQueryState("status", statusParam);
  const [level, setLevel] = useQueryState<IssueLevel | "">("level", enumParam(ISSUE_LEVELS, ""));
  const [search, setSearch] = useQueryState("q", stringParam());
  const [debounced, setDebounced] = React.useState(search);
  const [dateFrom, setDateFrom] = useQueryState("from", stringParam());
  const [dateTo, setDateTo] = useQueryState("to", stringParam());
  const [offset, setOffset] = useQueryState("offset", numberParam());
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [trendWindow, setTrendWindow] = useQueryState("trend", enumParam(TREND_WINDOWS, "24h"));

  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  // Reset paging + selection whenever the filters or project change, but not on
  // first mount — that would wipe an offset restored from the URL.
  const mounted = React.useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally resets on filter change
  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setOffset(0);
    setSelected(new Set());
  }, [status, level, debounced, dateFrom, dateTo, projectId]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["issues", projectId, status, level, debounced, dateFrom, dateTo, offset],
    queryFn: () =>
      api.issues.list(currentProject!.id, {
        status,
        level,
        q: debounced,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    enabled: !!projectId,
  });

  const issues = data?.results ?? [];
  const total = data?.count ?? 0;
  const issueIds = issues.map((i) => i.id);

  const { data: trends } = useQuery({
    queryKey: ["issue-trends", projectId, trendWindow, issueIds.join(",")],
    queryFn: () => api.issues.trends(currentProject!.id, issueIds, { period: trendWindow }),
    enabled: !!projectId && issueIds.length > 0,
  });

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["issues", projectId] });
    qc.invalidateQueries({ queryKey: ["issue-trends", projectId] });
  }, [qc, projectId]);

  const statusMut = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "resolve" | "ignore" | "unresolve" }) =>
      api.issues[action](currentProject!.id, id),
    onSuccess: invalidate,
  });
  const priorityMut = useMutation({
    mutationFn: ({ id, priority }: { id: string; priority: IssuePriority }) =>
      api.issues.setPriority(currentProject!.id, id, priority),
    onSuccess: invalidate,
  });
  const assignMut = useMutation({
    mutationFn: ({ id, ids }: { id: string; ids: string[] }) =>
      api.issues.assign(currentProject!.id, id, ids),
    onSuccess: invalidate,
  });
  const bulkMut = useMutation({
    mutationFn: (body: { ids: string[]; action: BulkAction; value?: IssuePriority | string[] }) =>
      api.issues.bulk(currentProject!.id, body),
    onSuccess: () => {
      setSelected(new Set());
      invalidate();
    },
  });

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allSelected = issues.length > 0 && issues.every((i) => selected.has(i.id));
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(issueIds));
  }

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} action={<ProjectSwitcher />} />

      <div className="space-y-4 p-5 sm:p-8">
        {/* Filters */}
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
            value={status}
            onChange={(e) => setStatus(e.target.value as IssueStatus | "")}
            className="sm:w-44"
            aria-label={tcol("status")}
          >
            <option value="">{ts("all")}</option>
            <option value="unresolved">{ts("unresolved")}</option>
            <option value="resolved">{ts("resolved")}</option>
            <option value="ignored">{ts("ignored")}</option>
            <option value="archived">{ts("archived")}</option>
          </Select>
          <Select
            value={level}
            onChange={(e) => setLevel(e.target.value as IssueLevel | "")}
            className="sm:w-44"
            aria-label={tcol("level")}
          >
            <option value="">{tl("all")}</option>
            <option value="fatal">{tl("fatal")}</option>
            <option value="error">{tl("error")}</option>
            <option value="warning">{tl("warning")}</option>
            <option value="info">{tl("info")}</option>
            <option value="debug">{tl("debug")}</option>
          </Select>
          <DatePicker
            value={dateFrom}
            onChange={setDateFrom}
            className="sm:w-48"
            placeholder={t("dateFrom")}
            ariaLabel={t("dateFrom")}
          />
          <DatePicker
            value={dateTo}
            onChange={setDateTo}
            className="sm:w-48"
            placeholder={t("dateTo")}
            ariaLabel={t("dateTo")}
          />
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <BulkBar
            count={selected.size}
            orgId={orgId}
            saving={bulkMut.isPending}
            onAction={(action, value) => bulkMut.mutate({ ids: [...selected], action, value })}
            onAssign={(ids) => bulkMut.mutate({ ids: [...selected], action: "assign", value: ids })}
            onClear={() => setSelected(new Set())}
          />
        )}

        <Card className="overflow-hidden">
          {isLoading ? (
            <IssuesSkeleton />
          ) : isError || !currentProject || issues.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<Bug className="h-8 w-8" />} message={t("empty")} />
            </div>
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH className="w-10">
                    <Checkbox
                      aria-label={t("bulk.selectAll")}
                      checked={allSelected}
                      indeterminate={selected.size > 0 && !allSelected}
                      onCheckedChange={toggleAll}
                    />
                  </TH>
                  <TH>{tcol("issue")}</TH>
                  <TH className="hidden lg:table-cell">
                    <div className="flex items-center gap-2">
                      <span>{tcol("trend")}</span>
                      <TrendToggle value={trendWindow} onChange={setTrendWindow} />
                    </div>
                  </TH>
                  <TH className="text-end">{tcol("events")}</TH>
                  <TH className="hidden xl:table-cell">{tcol("age")}</TH>
                  <TH className="hidden md:table-cell">{tcol("lastSeen")}</TH>
                  <TH className="hidden lg:table-cell">{tcol("assignee")}</TH>
                  <TH className="hidden sm:table-cell">{tcol("priority")}</TH>
                  <TH>{tcol("status")}</TH>
                  <TH className="w-10" aria-label={t("actions.more")} />
                </TR>
              </THead>
              <TBody>
                {issues.map((issue) => (
                  <TR
                    key={issue.id}
                    className={cn("cursor-pointer", selected.has(issue.id) && "bg-accent-soft/40")}
                    onClick={() => router.push(`/issues/${issue.id}`)}
                  >
                    <TD className="w-10" onClick={(e) => e.stopPropagation()}>
                      <div className="relative inline-flex">
                        {issue.has_seen === false && (
                          <span
                            role="img"
                            aria-label={t("unread")}
                            title={t("unread")}
                            className="absolute -top-3 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-accent"
                          />
                        )}
                        <Checkbox
                          aria-label={t("bulk.selectOne")}
                          checked={selected.has(issue.id)}
                          onCheckedChange={() => toggleSelect(issue.id)}
                        />
                      </div>
                    </TD>
                    <TD className="max-w-[300px]">
                      <div className="block w-[300px] max-w-full min-w-0">
                        <div className="flex items-center gap-2">
                          <LevelBadge level={issue.level} label={tl(issue.level)} />
                        </div>
                        <Tooltip content={issue.type}>
                          <span
                            className={cn(
                              "mt-1 block truncate",
                              issue.has_seen === false ? "font-semibold" : "font-medium"
                            )}
                          >
                            {issue.type}
                          </span>
                        </Tooltip>
                        <Tooltip content={issue.value || issue.culprit}>
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {issue.value || issue.culprit}
                          </span>
                        </Tooltip>
                      </div>
                    </TD>
                    <TD className="hidden lg:table-cell">
                      <Sparkline
                        data={trends?.[issue.id] ?? new Array(TREND_BUCKETS[trendWindow]).fill(0)}
                        unit={trendWindow === "24h" ? "hour" : "day"}
                      />
                    </TD>
                    <TD className="text-end tabular-nums">
                      {formatNumber(issue.times_seen, locale)}
                    </TD>
                    <TD className="hidden whitespace-nowrap text-muted-foreground xl:table-cell">
                      <RelativeTime date={issue.first_seen} />
                    </TD>
                    <TD className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                      <RelativeTime date={issue.last_seen} />
                    </TD>
                    <TD className="hidden lg:table-cell" onClick={(e) => e.stopPropagation()}>
                      <AssignDropdown
                        orgId={orgId}
                        assigned={issue.assignees}
                        saving={assignMut.isPending}
                        compact
                        onSave={(ids) => assignMut.mutate({ id: issue.id, ids })}
                      />
                    </TD>
                    <TD className="hidden sm:table-cell" onClick={(e) => e.stopPropagation()}>
                      <PriorityCell
                        issue={issue}
                        disabled={priorityMut.isPending}
                        onChange={(priority) => priorityMut.mutate({ id: issue.id, priority })}
                      />
                    </TD>
                    <TD>
                      <StatusBadge status={issue.status} label={ts(issue.status)} />
                    </TD>
                    <TD className="w-10" onClick={(e) => e.stopPropagation()}>
                      <RowActions
                        issue={issue}
                        onStatus={(action) => statusMut.mutate({ id: issue.id, action })}
                      />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        {/* Pagination */}
        {!isLoading && total > 0 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span className="tabular-nums">
              {tpag("showing", {
                from: localizeDigits(from, locale),
                to: localizeDigits(to, locale),
                total: localizeDigits(total, locale),
              })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!hasPrev}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
                {tpag("prev")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasNext}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                {tpag("next")}
                <ChevronRight className="h-4 w-4 rtl:rotate-180" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TrendToggle({
  value,
  onChange,
}: {
  value: "24h" | "30d";
  onChange: (v: "24h" | "30d") => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border" dir="ltr">
      {(["24h", "30d"] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            "px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition-colors",
            value === opt
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-muted"
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function PriorityCell({
  issue,
  onChange,
  disabled,
}: {
  issue: Issue;
  onChange: (p: IssuePriority) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("dashboard.issues.priority");
  return (
    <Popover
      align="end"
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          disabled={disabled}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-opacity disabled:opacity-50",
            PRIORITY_BADGE[issue.priority]
          )}
        >
          <Flag className="h-3 w-3" />
          {t(issue.priority)}
        </button>
      )}
    >
      {(close) =>
        PRIORITIES.map((p) => (
          <PopoverItem
            key={p}
            onClick={() => {
              onChange(p);
              close();
            }}
          >
            <span className={cn("h-2 w-2 rounded-full", PRIORITY_DOT[p])} />
            {t(p)}
          </PopoverItem>
        ))
      }
    </Popover>
  );
}

function RowActions({
  issue,
  onStatus,
}: {
  issue: Issue;
  onStatus: (action: "resolve" | "ignore" | "unresolve") => void;
}) {
  const t = useTranslations("dashboard.issues.actions");
  return (
    <Popover
      align="end"
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={t("more")}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      )}
    >
      {(close) => (
        <>
          {issue.status !== "resolved" && (
            <PopoverItem
              onClick={() => {
                onStatus("resolve");
                close();
              }}
            >
              <CheckCircle2 className="h-4 w-4 text-success" />
              {t("resolve")}
            </PopoverItem>
          )}
          {issue.status !== "ignored" && (
            <PopoverItem
              onClick={() => {
                onStatus("ignore");
                close();
              }}
            >
              <EyeOff className="h-4 w-4" />
              {t("ignore")}
            </PopoverItem>
          )}
          {issue.status !== "unresolved" && (
            <PopoverItem
              onClick={() => {
                onStatus("unresolve");
                close();
              }}
            >
              <RotateCcw className="h-4 w-4" />
              {t("unresolve")}
            </PopoverItem>
          )}
        </>
      )}
    </Popover>
  );
}

function BulkBar({
  count,
  orgId,
  saving,
  onAction,
  onAssign,
  onClear,
}: {
  count: number;
  orgId?: string;
  saving: boolean;
  onAction: (action: BulkAction, value?: IssuePriority) => void;
  onAssign: (ids: string[]) => void;
  onClear: () => void;
}) {
  const t = useTranslations("dashboard.issues.bulk");
  const tp = useTranslations("dashboard.issues.priority");
  const locale = useLocale();
  const [picked, setPicked] = React.useState<string[]>([]);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-border bg-card px-4 py-2.5 shadow-sm">
      <span className="text-sm font-medium">
        {t("selected", { count: localizeDigits(count, locale) })}
      </span>
      <div className="mx-1 h-5 w-px bg-border" />
      <Button size="sm" variant="outline" onClick={() => onAction("resolve")} disabled={saving}>
        <CheckCircle2 className="h-4 w-4 text-success" />
        {t("resolve")}
      </Button>
      <Button size="sm" variant="outline" onClick={() => onAction("ignore")} disabled={saving}>
        <EyeOff className="h-4 w-4" />
        {t("ignore")}
      </Button>
      <Button size="sm" variant="outline" onClick={() => onAction("unresolve")} disabled={saving}>
        <RotateCcw className="h-4 w-4" />
        {t("unresolve")}
      </Button>
      <Popover
        align="start"
        trigger={({ toggle }) => (
          <Button size="sm" variant="outline" onClick={toggle} disabled={saving}>
            <Flag className="h-4 w-4" />
            {t("priority")}
          </Button>
        )}
      >
        {(close) =>
          PRIORITIES.map((p) => (
            <PopoverItem
              key={p}
              onClick={() => {
                onAction("priority", p);
                close();
              }}
            >
              <span className={cn("h-2 w-2 rounded-full", PRIORITY_DOT[p])} />
              {tp(p)}
            </PopoverItem>
          ))
        }
      </Popover>
      <AssignDropdown
        orgId={orgId}
        assigned={picked}
        saving={saving}
        onSave={(ids) => {
          setPicked(ids);
          onAssign(ids);
        }}
      />
      <button
        type="button"
        onClick={onClear}
        className="ms-auto inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
        {t("clear")}
      </button>
    </div>
  );
}

function IssuesSkeleton() {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4">
          <div className="h-9 flex-1 animate-shimmer rounded-md" />
          <div className="h-5 w-16 animate-shimmer rounded-md" />
        </div>
      ))}
    </div>
  );
}

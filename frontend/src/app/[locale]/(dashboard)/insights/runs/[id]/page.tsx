"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { SpanWaterfall } from "@/components/dashboard/SpanWaterfall";
import { StatTile } from "@/components/dashboard/insights/Widgets";
import { useProjects } from "@/components/providers/ProjectProvider";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Link } from "@/i18n/routing";
import { api } from "@/lib/api";
import type { AiSpan, AiSpanKind } from "@/lib/types";
import { cn, formatCompact, formatDuration, formatNumber } from "@/lib/utils";

const KIND_VARIANT: Record<AiSpanKind, "default" | "accent" | "success" | "danger" | "muted" | "outline"> = {
  agent: "accent",
  llm: "default",
  tool: "success",
  handoff: "accent",
  embeddings: "muted",
  mcp: "outline",
};

export default function AgentRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: traceId } = React.use(params);
  const t = useTranslations("dashboard.insights");
  const locale = useLocale();
  const { currentProject } = useProjects();
  const projectId = currentProject?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["insights-run", projectId, traceId],
    queryFn: () => api.insights.run(currentProject!.id, traceId),
    enabled: !!projectId,
  });

  // Full underlying trace (all spans, not just AI/MCP).
  const trace = useQuery({
    queryKey: ["insights-run-trace", projectId, data?.event_id],
    queryFn: () => api.performance.transaction(currentProject!.id, data!.event_id as string),
    enabled: !!projectId && !!data?.event_id,
  });

  const num = (n: number) => formatNumber(n, locale);
  const compact = (n: number) => formatCompact(n, locale);
  const dur = (ms: number | null | undefined) => formatDuration(ms ?? null, locale);

  if (isLoading) {
    return (
      <div className="space-y-4 p-5 sm:p-8">
        <div className="h-8 w-1/2 animate-shimmer rounded-md" />
        <div className="h-40 animate-shimmer rounded-[var(--radius)]" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="p-5 sm:p-8">
        <Link
          href="/insights"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          {t("run.back")}
        </Link>
        <p className="mt-6 text-sm text-muted-foreground">{t("run.notFound")}</p>
      </div>
    );
  }

  const { summary, spans } = data;
  // Timeline geometry: lay each span out relative to the run window.
  const starts = spans.map((s) => new Date(s.timestamp).getTime());
  const t0 = Math.min(...starts);
  const span0 = spans.length ? Math.max(...spans.map((s, i) => starts[i] + s.duration_ms)) : t0;
  const totalMs = Math.max(1, span0 - t0);

  return (
    <div className="space-y-5 p-5 sm:p-8">
      <div className="flex flex-col gap-2">
        <Link
          href="/insights"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          {t("run.back")}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight" dir="ltr">
            {data.name || traceId.slice(0, 12)}
          </h1>
          {data.model && (
            <Badge variant="muted" className="font-mono">
              {data.model}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t("stats.llmCalls")} value={num(summary.llm_calls)} />
        <StatTile label={t("stats.toolCalls")} value={num(summary.tool_calls)} />
        <StatTile label={t("stats.requests")} value={num(summary.mcp_requests)} />
        <StatTile label={t("stats.avgDuration")} value={dur(summary.duration_ms)} />
        <StatTile label={t("stats.totalTokens")} value={compact(summary.tokens.total)} />
        <StatTile label={t("stats.inputTokens")} value={compact(summary.tokens.input)} sub={`${t("stats.cached")} ${compact(summary.tokens.cached)}`} />
        <StatTile label={t("stats.outputTokens")} value={compact(summary.tokens.output)} />
        <StatTile label={t("stats.errors")} value={num(summary.errors)} tone={summary.errors > 0 ? "danger" : "default"} />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">
          {t("run.timeline")}
        </div>
        <ul className="divide-y divide-border">
          {spans.map((s, i) => (
            <SpanRow
              key={s.id}
              span={s}
              left={((starts[i] - t0) / totalMs) * 100}
              width={Math.max(1.5, (s.duration_ms / totalMs) * 100)}
              dur={dur}
              compact={compact}
            />
          ))}
        </ul>
      </Card>

      {data.event_id && (
        <Card className="p-5">
          <div className="mb-4 text-sm font-semibold">{t("run.fullTrace")}</div>
          {trace.isLoading ? (
            <div className="h-40 animate-shimmer rounded-[var(--radius)]" />
          ) : trace.data ? (
            <SpanWaterfall
              spans={trace.data.spans}
              total={trace.data.duration_ms}
              rootSpanId={trace.data.span_id}
              truncated={trace.data.spans_truncated}
              spanCount={trace.data.span_count}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t("run.notFound")}</p>
          )}
        </Card>
      )}
    </div>
  );
}

function SpanRow({
  span,
  left,
  width,
  dur,
  compact,
}: {
  span: AiSpan;
  left: number;
  width: number;
  dur: (ms: number | null | undefined) => string;
  compact: (n: number) => string;
}) {
  const label =
    span.kind === "mcp"
      ? [span.mcp_method, span.mcp_tool || span.mcp_resource || span.mcp_prompt]
          .filter(Boolean)
          .join(" ")
      : span.name || span.description || span.op;
  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant={KIND_VARIANT[span.kind]} className="shrink-0 capitalize">
            {span.kind}
          </Badge>
          <span className="min-w-0 truncate text-sm" dir="ltr" title={label}>
            {label}
          </span>
          {span.is_failed && <Badge variant="danger">!</Badge>}
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs tabular-nums text-muted-foreground" dir="ltr">
          {span.total_tokens > 0 && <span>{compact(span.total_tokens)} tok</span>}
          <span className="text-foreground">{dur(span.duration_ms)}</span>
        </div>
      </div>
      <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            span.is_failed ? "bg-danger" : "bg-accent"
          )}
          style={{ marginInlineStart: `${left}%`, width: `${width}%` }}
          aria-hidden
        />
      </div>
    </li>
  );
}

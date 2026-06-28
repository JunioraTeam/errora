"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { cn, formatNumber } from "@/lib/utils";

/** Event-volume trend for a single issue with a 24h / 30d toggle (Sentry-style). */
export function IssueTrendChart({ projectId, issueId }: { projectId: string; issueId: string }) {
  const t = useTranslations("dashboard.issueDetail");
  const locale = useLocale();
  const [period, setPeriod] = React.useState<"24h" | "30d">("24h");

  const { data, isLoading } = useQuery({
    queryKey: ["issue-series", projectId, issueId, period],
    queryFn: () => api.issues.series(projectId, issueId, period),
  });

  const buckets = data?.buckets ?? [];
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const total = buckets.reduce((s, b) => s + b.count, 0);

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("trend")}
          </h3>
          <span className="text-xs text-muted-foreground">
            {t("trendTotal", { count: formatNumber(total, locale) })}
          </span>
        </div>
        <div className="inline-flex overflow-hidden rounded-md border border-border" dir="ltr">
          {(["24h", "30d"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setPeriod(opt)}
              className={cn(
                "px-2 py-1 text-xs font-medium tabular-nums transition-colors",
                period === opt
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="h-28 animate-shimmer rounded-[var(--radius-sm)]" />
      ) : (
        <div className="flex h-28 items-end gap-px" dir="ltr">
          {buckets.map((b) => (
            <div
              key={b.ts}
              className="group/bar relative flex-1 rounded-sm bg-accent/50 transition-colors hover:bg-accent"
              style={{ height: `${Math.max(3, Math.round((b.count / max) * 100))}%` }}
            >
              <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-[var(--radius-sm)] border border-border bg-card px-2 py-1 text-[11px] shadow-md group-hover/bar:flex">
                <span className="font-medium">{formatNumber(b.count, locale)}</span>
                <span className="ms-1.5 text-muted-foreground">{formatDateTime(b.ts, locale)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

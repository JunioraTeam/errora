"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { EmptyState, PageHeader } from "@/components/dashboard/PageHeader";
import { useOrg } from "@/components/providers/OrgProvider";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Input";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { api } from "@/lib/api";
import type { AutoFixRun, AutofixRunStatus } from "@/lib/types";

const STATUSES: AutofixRunStatus[] = [
  "queued",
  "analyzing",
  "generating",
  "creating_mr",
  "completed",
  "failed",
];

const ACTIVE: AutofixRunStatus[] = ["queued", "analyzing", "generating", "creating_mr"];

function statusVariant(s: AutofixRunStatus): "success" | "danger" | "accent" | "muted" {
  if (s === "completed") return "success";
  if (s === "failed") return "danger";
  return "accent";
}

export default function AiFixesPage() {
  const t = useTranslations("dashboard.aiFixes");
  const { currentOrg } = useOrg();
  const [status, setStatus] = React.useState<AutofixRunStatus | "">("");

  const { data, isLoading } = useQuery({
    queryKey: ["autofix-runs", currentOrg?.id, status],
    queryFn: () => api.autofixRuns.list(currentOrg!.id, { status }),
    enabled: !!currentOrg?.id,
    // Poll while any run is still in flight so the status stays live.
    refetchInterval: (q) =>
      (q.state.data?.results ?? []).some((r) => ACTIVE.includes(r.status)) ? 4000 : false,
  });

  const runs = data?.results ?? [];

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="space-y-4 p-5 sm:p-8">
        <div className="flex justify-end">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as AutofixRunStatus | "")}
            className="sm:w-52"
            aria-label={t("columns.status")}
          >
            <option value="">{t("allStatuses")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
        </div>

        <Card className="overflow-hidden">
          {isLoading ? (
            <div className="space-y-px">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-14 animate-shimmer" />
              ))}
            </div>
          ) : runs.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<Sparkles className="h-8 w-8" />} message={t("empty")} />
            </div>
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>{t("columns.issue")}</TH>
                  <TH className="hidden sm:table-cell">{t("columns.project")}</TH>
                  <TH className="hidden md:table-cell">{t("columns.agent")}</TH>
                  <TH>{t("columns.status")}</TH>
                  <TH className="hidden lg:table-cell">{t("columns.when")}</TH>
                </TR>
              </THead>
              <TBody>
                {runs.map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}

function RunRow({ run }: { run: AutoFixRun }) {
  const t = useTranslations("dashboard.aiFixes");
  const [open, setOpen] = React.useState(false);
  const hasDetail = !!(run.explanation || run.error || run.mr_url);

  return (
    <>
      <TR
        className={hasDetail ? "cursor-pointer" : undefined}
        onClick={() => hasDetail && setOpen((v) => !v)}
      >
        <TD>
          <span className="block max-w-xs truncate font-medium">{run.issue_title}</span>
          {run.triggered_by_name && (
            <span className="block truncate text-xs text-muted-foreground">
              {t("triggeredBy", { name: run.triggered_by_name })}
            </span>
          )}
        </TD>
        <TD className="hidden text-muted-foreground sm:table-cell">{run.project_name}</TD>
        <TD className="hidden font-mono text-xs text-muted-foreground md:table-cell">
          {run.provider} · {run.model}
        </TD>
        <TD>
          <Badge variant={statusVariant(run.status)}>{t(`status.${run.status}`)}</Badge>
        </TD>
        <TD className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
          <RelativeTime date={run.created_at} />
        </TD>
      </TR>
      {open && hasDetail && (
        <TR className="hover:bg-transparent">
          <TD colSpan={5} className="bg-muted/40">
            <div className="space-y-3 p-2 text-sm">
              {run.mr_url && (
                <a
                  href={run.mr_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline"
                  dir="ltr"
                >
                  <ExternalLink className="h-4 w-4" />
                  {t("viewMr")}
                </a>
              )}
              {run.explanation && (
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("explanation")}
                  </div>
                  <p className="whitespace-pre-wrap">{run.explanation}</p>
                </div>
              )}
              {run.error && (
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-danger">
                    {t("error")}
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-[var(--radius-sm)] bg-danger/10 p-2 font-mono text-xs text-danger">
                    {run.error}
                  </pre>
                </div>
              )}
              {run.tokens_used > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("tokens", { count: run.tokens_used })}
                </p>
              )}
            </div>
          </TD>
        </TR>
      )}
    </>
  );
}

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, FolderPlus, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { createPortal } from "react-dom";
import { EmptyState, PageHeader } from "@/components/dashboard/PageHeader";
import { TechIcon } from "@/components/dashboard/TechIcon";
import { useOrg } from "@/components/providers/OrgProvider";
import { useProjects } from "@/components/providers/ProjectProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Input";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { Link } from "@/i18n/routing";
import { api } from "@/lib/api";
import { formatDayKey, toISODate } from "@/lib/datetime";
import type { Project } from "@/lib/types";
import { formatNumber, localizeDigits } from "@/lib/utils";

const PLATFORMS = ["javascript", "python", "php", "php-laravel", "node", "go", "other"] as const;

type PlatformKey = (typeof PLATFORMS)[number];

function platformLabel(tp: (key: string) => string, platform: string): string {
  return (PLATFORMS as readonly string[]).includes(platform)
    ? tp(platform as PlatformKey)
    : platform;
}

export default function ProjectsPage() {
  const t = useTranslations("dashboard.projects");
  const tc = useTranslations("common");
  const tp = useTranslations("platforms");
  const locale = useLocale();
  const { projects, refetch, setCurrentProjectId } = useProjects();
  const { currentOrg } = useOrg();
  const qc = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ["project-stats", currentOrg?.id],
    queryFn: () => api.projects.stats(currentOrg!.id, 7),
    enabled: !!currentOrg?.id && projects.length > 0,
  });

  const [createOpen, setCreateOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [platform, setPlatform] = React.useState<string>("javascript");
  const [created, setCreated] = React.useState<Project | null>(null);

  const createMutation = useMutation({
    mutationFn: () => api.projects.create(currentOrg!.id, { name, platform }),
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      refetch();
      setCreated(project);
      setCreateOpen(false);
      setName("");
    },
  });

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <Button onClick={() => setCreateOpen(true)} disabled={!currentOrg}>
            <Plus className="h-4 w-4" />
            {t("create")}
          </Button>
        }
      />

      <div className="p-5 sm:p-8">
        {projects.length === 0 ? (
          <EmptyState
            icon={<FolderPlus className="h-8 w-8" />}
            message={t("empty")}
            action={
              <Button onClick={() => setCreateOpen(true)} disabled={!currentOrg}>
                <Plus className="h-4 w-4" />
                {t("create")}
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Link
                key={p.id}
                href="/issues"
                onClick={() => setCurrentProjectId(p.id)}
                className="group"
              >
                <Card className="h-full p-5 transition-all group-hover:-translate-y-0.5 group-hover:border-accent/40 group-hover:shadow-md">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                      <TechIcon name={p.platform} className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{p.name}</p>
                      <Badge variant="muted" className="mt-0.5">
                        {platformLabel(tp, p.platform)}
                      </Badge>
                    </div>
                  </div>
                  <ProjectTrendBars stats={stats?.[p.id]} />
                  <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      {t("openIssues")}:{" "}
                      <span className="font-medium text-foreground">
                        {formatNumber(p.open_issues_count ?? 0, locale)}
                      </span>
                    </span>
                    {p.last_event_at && (
                      <span className="text-xs">
                        <RelativeTime date={p.last_event_at} />
                      </span>
                    )}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title={t("createTitle")}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) createMutation.mutate();
          }}
          className="space-y-4"
        >
          <Field label={t("name")} htmlFor="project-name">
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              autoFocus
            />
          </Field>
          <Field label={t("platform")} htmlFor="project-platform">
            <Select
              id="project-platform"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              {PLATFORMS.map((pl) => (
                <option key={pl} value={pl}>
                  {tp(pl)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" loading={createMutation.isPending}>
              {tc("create")}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* DSN dialog after creation */}
      <Dialog
        open={!!created}
        onClose={() => setCreated(null)}
        title={t("dsnTitle")}
        description={t("dsnDesc")}
      >
        {created && (
          <div className="space-y-4">
            <DsnBox dsn={created.keys?.[0]?.dsn ?? ""} />
            <div className="flex justify-end">
              <Button onClick={() => setCreated(null)}>{tc("close")}</Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

type BarTip = { x: number; y: number; date: string; errors: number; transactions: number };

/** Per-project 7-day errors + transactions mini bar chart on the project card,
 * with y/x axes and a per-day hover tooltip (portalled so it isn't clipped). */
function ProjectTrendBars({ stats }: { stats?: { errors: number[]; transactions: number[] } }) {
  const t = useTranslations("dashboard.projects");
  const locale = useLocale();
  const [tip, setTip] = React.useState<BarTip | null>(null);

  const errors = stats?.errors ?? [];
  const transactions = stats?.transactions ?? [];
  const n = Math.max(errors.length, transactions.length, 7);
  const max = Math.max(1, ...errors, ...transactions);

  const dateFor = (i: number) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (n - 1 - i));
    return d;
  };

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-danger/70" />
          {t("errors")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-accent/70" />
          {t("transactions")}
        </span>
      </div>
      <div className="flex gap-1" dir="ltr">
        {/* y-axis: max tick + zero baseline */}
        <div className="flex w-5 shrink-0 flex-col justify-between py-px text-end text-[9px] tabular-nums text-muted-foreground">
          <span>{localizeDigits(max, locale)}</span>
          <span>0</span>
        </div>
        <div className="min-w-0 flex-1">
          {/* plot area, x-axis = bottom border, y-axis = start border */}
          <div className="flex h-12 items-end gap-1 border-b border-s border-border ps-1">
            {Array.from({ length: n }).map((_, i) => {
              const e = errors[i] ?? 0;
              const tx = transactions[i] ?? 0;
              const label = `${formatDayKey(toISODate(dateFor(i)), locale)}: ${e} / ${tx}`;
              return (
                <div
                  role="img"
                  key={i}
                  aria-label={label}
                  className="flex h-full flex-1 items-end justify-center gap-px"
                  onMouseEnter={(ev) => {
                    const r = ev.currentTarget.getBoundingClientRect();
                    setTip({
                      x: r.left + r.width / 2,
                      y: r.top,
                      date: formatDayKey(toISODate(dateFor(i)), locale),
                      errors: e,
                      transactions: tx,
                    });
                  }}
                  onMouseLeave={() => setTip(null)}
                >
                  <span
                    className="w-1/2 rounded-sm bg-danger/60"
                    style={{ height: `${e === 0 ? 0 : Math.max(4, Math.round((e / max) * 100))}%` }}
                  />
                  <span
                    className="w-1/2 rounded-sm bg-accent/60"
                    style={{
                      height: `${tx === 0 ? 0 : Math.max(4, Math.round((tx / max) * 100))}%`,
                    }}
                  />
                </div>
              );
            })}
          </div>
          {/* x-axis tick labels (day of month) */}
          <div className="mt-0.5 flex gap-1 ps-1 text-[9px] tabular-nums text-muted-foreground">
            {Array.from({ length: n }).map((_, i) => (
              <span key={i} className="flex-1 text-center">
                {localizeDigits(dateFor(i).getDate(), locale)}
              </span>
            ))}
          </div>
        </div>
      </div>

      {tip &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: tip.x,
              top: tip.y - 8,
              transform: "translate(-50%, -100%)",
            }}
            className="pointer-events-none z-[100] whitespace-nowrap rounded-[var(--radius-sm)] border border-border bg-card px-2 py-1 text-[11px] shadow-md"
          >
            <div className="mb-0.5 font-medium">{tip.date}</div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-danger/70" />
              <span className="text-muted-foreground">{t("errors")}</span>
              <span className="ms-auto ps-2 tabular-nums">
                {localizeDigits(tip.errors, locale)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-accent/70" />
              <span className="text-muted-foreground">{t("transactions")}</span>
              <span className="ms-auto ps-2 tabular-nums">
                {localizeDigits(tip.transactions, locale)}
              </span>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

function DsnBox({ dsn }: { dsn: string }) {
  const tc = useTranslations("common");
  const [copied, setCopied] = React.useState(false);

  function copy() {
    navigator.clipboard?.writeText(dsn);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-muted px-3 py-2.5">
      <code dir="ltr" className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
        {dsn || "—"}
      </code>
      <button
        type="button"
        onClick={copy}
        title={tc("copy")}
        className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
      >
        {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

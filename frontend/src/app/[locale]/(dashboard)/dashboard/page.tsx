"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, AlertCircle, Bug, FolderKanban } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { EmptyState, PageHeader } from "@/components/dashboard/PageHeader";
import { useAuth } from "@/components/providers/AuthProvider";
import { useProjects } from "@/components/providers/ProjectProvider";
import { LevelBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { Link } from "@/i18n/routing";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/utils";

export default function DashboardOverviewPage() {
  const t = useTranslations("dashboard.overview");
  const tl = useTranslations("dashboard.issues.level");
  const ti = useTranslations("dashboard.issues");
  const locale = useLocale();
  const { user } = useAuth();
  const { currentProject, projects } = useProjects();

  const { data: issuesData } = useQuery({
    queryKey: ["issues", currentProject?.id, "overview"],
    queryFn: () => api.issues.list(currentProject!.id, { limit: 5 }),
    enabled: !!currentProject?.id,
  });

  const recent = issuesData?.results ?? [];
  const total = issuesData?.count ?? 0;
  const unresolved = recent.filter((i) => i.status === "unresolved").length;
  const eventsToday = recent.reduce((sum, i) => sum + (i.times_seen || 0), 0);

  const stats = [
    { label: t("totalIssues"), value: total, icon: Bug },
    { label: t("unresolved"), value: unresolved, icon: AlertCircle },
    { label: t("eventsToday"), value: eventsToday, icon: Activity },
    { label: t("projects"), value: projects.length, icon: FolderKanban },
  ];

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={user ? t("welcome", { name: user.name }) : undefined}
      />

      <div className="space-y-6 p-5 sm:p-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label} className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{s.label}</span>
                <s.icon className="h-4 w-4 text-accent" />
              </div>
              <div className="mt-2 text-3xl font-bold tabular-nums tracking-tight">
                {formatNumber(s.value, locale)}
              </div>
            </Card>
          ))}
        </div>

        <Card>
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="font-semibold">{t("recentIssues")}</h2>
            <Link href="/issues">
              <Button variant="ghost" size="sm">
                {t("viewAll")}
              </Button>
            </Link>
          </div>
          {recent.length === 0 ? (
            <div className="p-5">
              <EmptyState message={ti("empty")} />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((issue) => (
                <li key={issue.id}>
                  <Link
                    href={`/issues/${issue.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <LevelBadge level={issue.level} label={tl(issue.level)} />
                      <span className="truncate font-medium">{issue.title}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2.5 text-xs text-muted-foreground">
                      {(issue.project_name ?? currentProject?.name) && (
                        <span className="hidden max-w-[10rem] truncate rounded-full bg-muted px-2 py-0.5 font-medium sm:inline">
                          {issue.project_name ?? currentProject?.name}
                        </span>
                      )}
                      <RelativeTime date={issue.last_seen} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

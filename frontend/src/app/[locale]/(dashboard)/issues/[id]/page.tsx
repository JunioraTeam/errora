"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Bookmark,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Eye,
  EyeOff,
  RotateCcw,
  Send,
  Share2,
  Sparkles,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { AssignDropdown } from "@/components/dashboard/AssignDropdown";
import { AutofixLiveLog } from "@/components/dashboard/AutofixLiveLog";
import { EventDetailBody } from "@/components/dashboard/EventInsights";
import { ExternalIssueSection } from "@/components/dashboard/ExternalIssueSection";
import { IssueTrendChart } from "@/components/dashboard/IssueTrendChart";
import { useOrg } from "@/components/providers/OrgProvider";
import { useProjects } from "@/components/providers/ProjectProvider";
import { LevelBadge, StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { Link } from "@/i18n/routing";
import { ApiError, api, unwrapList } from "@/lib/api";
import { issueToMarkdown } from "@/lib/issueMarkdown";
import type {
  AutofixState,
  EventContexts,
  EventData,
  IssueDetail,
  IssueRepository,
} from "@/lib/types";
import { cn, formatNumber } from "@/lib/utils";

export default function IssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  const t = useTranslations("dashboard.issueDetail");
  const ts = useTranslations("dashboard.issues.status");
  const tl = useTranslations("dashboard.issues.level");
  const tc = useTranslations("common");
  const locale = useLocale();
  const qc = useQueryClient();
  const { currentProject } = useProjects();
  const { currentOrg } = useOrg();
  const projectId = currentProject?.id;

  const [tab, setTab] = React.useState("details");
  const [autofixError, setAutofixError] = React.useState<string | null>(null);
  const [streamRunId, setStreamRunId] = React.useState<string | null>(null);

  const { data: issue, isLoading } = useQuery({
    queryKey: ["issue", projectId, id],
    queryFn: () => api.issues.get(projectId!, id),
    enabled: !!projectId,
  });

  // Opening the issue marks it seen server-side; invalidate the cached issues
  // list so the unread dot is gone when the user navigates back (e.g. browser
  // Back), instead of showing stale until a manual refresh.
  React.useEffect(() => {
    if (issue) qc.invalidateQueries({ queryKey: ["issues", projectId] });
  }, [issue, projectId, qc]);

  // Gate the Auto-fix button on whether at least one AI agent is configured.
  const { data: aiConfigsRaw } = useQuery({
    queryKey: ["ai-configs", currentOrg?.id],
    queryFn: () => api.aiConfigs.list(currentOrg!.id),
    enabled: !!currentOrg?.id,
  });
  const hasAgent = aiConfigsRaw
    ? unwrapList(aiConfigsRaw).some((c) => c.enabled && c.has_key)
    : false;

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["issue", projectId, id] });
    qc.invalidateQueries({ queryKey: ["issues", projectId] });
  }

  const resolve = useMutation({
    mutationFn: () => api.issues.resolve(projectId!, id),
    onSuccess: invalidate,
  });
  const unresolve = useMutation({
    mutationFn: () => api.issues.unresolve(projectId!, id),
    onSuccess: invalidate,
  });
  const ignore = useMutation({
    mutationFn: () => api.issues.ignore(projectId!, id),
    onSuccess: invalidate,
  });
  const autofix = useMutation({
    mutationFn: () => api.issues.autofix(projectId!, id),
    onSuccess: (run) => {
      invalidate();
      setStreamRunId(run.id);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 404) {
        setAutofixError(t("autofixUnavailable"));
      } else if (
        e instanceof ApiError &&
        e.status === 409 &&
        e.body &&
        typeof e.body === "object" &&
        "id" in e.body
      ) {
        // A run is already in flight — stream that one instead.
        setStreamRunId(String((e.body as { id: string }).id));
      } else {
        setAutofixError(t("autofixStates.failed"));
      }
    },
  });
  const assign = useMutation({
    mutationFn: (assignees: string[]) => api.issues.assign(projectId!, id, assignees),
    onSuccess: invalidate,
  });
  const archive = useMutation({
    mutationFn: () => api.issues.archive(projectId!, id),
    onSuccess: invalidate,
  });
  const bookmark = useMutation({
    mutationFn: () => api.issues.bookmark(projectId!, id),
    onSuccess: invalidate,
  });

  // Re-attach the live stream after a reload if a fix is still running.
  const runningState = issue?.autofix_state;
  React.useEffect(() => {
    if (!projectId || streamRunId || runningState !== "running") return;
    const ACTIVE = ["queued", "analyzing", "generating", "creating_mr"];
    api.issues
      .autofixRuns(projectId, id)
      .then((runs) => {
        const active = runs.find((r) => ACTIVE.includes(r.status));
        if (active) setStreamRunId(active.id);
      })
      .catch(() => {});
  }, [projectId, id, runningState, streamRunId]);

  if (isLoading || !issue) {
    return (
      <div className="space-y-4 p-5 sm:p-8">
        <div className="h-8 w-2/3 animate-shimmer rounded-md" />
        <div className="h-40 animate-shimmer rounded-[var(--radius)]" />
      </div>
    );
  }

  const event = issue.latest_event;
  const autofixState: AutofixState = autofix.isPending ? "running" : issue.autofix_state || "idle";

  const meta = [
    { label: t("culprit"), value: issue.culprit, mono: true },
    {
      label: t("events"),
      value: formatNumber(issue.times_seen, locale),
    },
    {
      label: t("users"),
      value: (
        <span className="inline-flex items-center gap-1">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          {formatNumber(issue.users_seen ?? 0, locale)}
        </span>
      ),
    },
    { label: t("firstSeen"), value: <RelativeTime date={issue.first_seen} /> },
    { label: t("lastSeen"), value: <RelativeTime date={issue.last_seen} /> },
  ];

  return (
    <div>
      {/* Header */}
      <div className="border-b border-border px-5 py-5 sm:px-8">
        <Link
          href="/issues"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          {tc("back")}
        </Link>

        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <LevelBadge level={issue.level} label={tl(issue.level)} />
              <StatusBadge status={issue.status} label={ts(issue.status)} />
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">{issue.type}</h1>
            <p className="mt-1 font-mono text-sm text-muted-foreground" dir="ltr">
              {issue.value}
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => bookmark.mutate()}
              loading={bookmark.isPending}
              aria-pressed={issue.is_bookmarked}
              title={issue.is_bookmarked ? t("bookmarked") : t("bookmark")}
            >
              <Bookmark
                className={cn("h-4 w-4", issue.is_bookmarked && "fill-accent text-accent")}
              />
              <SwapLabel a={t("bookmark")} b={t("bookmarked")} showB={!!issue.is_bookmarked} />
            </Button>
            <ShareButton />
            <CopyMarkdownButton issue={issue} />
            {issue.status === "resolved" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => unresolve.mutate()}
                loading={unresolve.isPending}
              >
                <RotateCcw className="h-4 w-4" />
                {t("unresolve")}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => resolve.mutate()}
                loading={resolve.isPending}
              >
                <CheckCircle2 className="h-4 w-4" />
                {t("resolve")}
              </Button>
            )}
            {issue.status === "ignored" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => unresolve.mutate()}
                loading={unresolve.isPending}
              >
                <Eye className="h-4 w-4" />
                {t("unignore")}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => ignore.mutate()}
                loading={ignore.isPending}
              >
                <EyeOff className="h-4 w-4" />
                {t("ignore")}
              </Button>
            )}
            {issue.status === "archived" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => unresolve.mutate()}
                loading={unresolve.isPending}
              >
                <RotateCcw className="h-4 w-4" />
                {t("unarchive")}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => archive.mutate()}
                loading={archive.isPending}
              >
                <Archive className="h-4 w-4" />
                {t("archive")}
              </Button>
            )}
            <AssignDropdown
              orgId={currentOrg?.id}
              assigned={issue.assignees}
              saving={assign.isPending}
              onSave={(ids) => assign.mutate(ids)}
            />
            {hasAgent && (
              <Button
                size="sm"
                onClick={() => {
                  setAutofixError(null);
                  autofix.mutate();
                }}
                loading={autofixState === "running" || autofixState === "pending"}
                disabled={autofixState === "completed"}
              >
                <Sparkles className="h-4 w-4" />
                {t(`autofixStates.${autofixState}`)}
              </Button>
            )}
          </div>
        </div>

        {autofixError && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            {autofixError}
          </p>
        )}

        {streamRunId && projectId && (
          <AutofixLiveLog
            projectId={projectId}
            issueId={id}
            runId={streamRunId}
            onDone={() => invalidate()}
          />
        )}
      </div>

      {/* Meta strip */}
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
        {meta.map((m) => (
          <div key={m.label} className="bg-background px-5 py-3 sm:px-8">
            <div className="text-xs text-muted-foreground">{m.label}</div>
            <div
              className={cn("mt-0.5 truncate text-sm font-medium", m.mono && "font-mono")}
              dir={m.mono ? "ltr" : undefined}
            >
              {m.value || "—"}
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="p-5 sm:p-8">
        <Tabs
          value={tab}
          onValueChange={setTab}
          items={[
            { value: "details", label: t("tabs.details") },
            { value: "events", label: t("tabs.events") },
            { value: "comments", label: t("tabs.comments") },
          ]}
        />

        <div className="mt-5">
          {tab === "details" && (
            <div className="space-y-6">
              {projectId && <IssueTrendChart projectId={projectId} issueId={id} />}
              {projectId && <ExternalIssueSection projectId={projectId} issue={issue} />}
              <DetailsTab data={event?.data} repository={issue.repository} />
            </div>
          )}
          {tab === "events" && projectId && (
            <EventsTab projectId={projectId} issueId={id} repository={issue.repository} />
          )}
          {tab === "comments" && projectId && <CommentsTab projectId={projectId} issueId={id} />}
        </div>
      </div>
    </div>
  );
}

function CopyMarkdownButton({ issue }: { issue: IssueDetail }) {
  const t = useTranslations("dashboard.issueDetail");
  const tc = useTranslations("common");
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard?.writeText(issueToMarkdown(issue)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="h-4 w-4 text-success" /> : <ClipboardCopy className="h-4 w-4" />}
      <SwapLabel a={t("copyMarkdown")} b={tc("copied")} showB={copied} />
    </Button>
  );
}

function ShareButton() {
  const t = useTranslations("dashboard.issueDetail");
  const tc = useTranslations("common");
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard?.writeText(window.location.href).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="h-4 w-4 text-success" /> : <Share2 className="h-4 w-4" />}
      <SwapLabel a={t("shareUrl")} b={tc("copied")} showB={copied} />
    </Button>
  );
}

/** Renders one of two labels without a width change: both occupy the same grid
 * cell so the element is always sized to the wider label. */
function SwapLabel({ a, b, showB }: { a: string; b: string; showB: boolean }) {
  return (
    <span className="grid">
      <span className="invisible col-start-1 row-start-1">{a.length >= b.length ? a : b}</span>
      <span className="col-start-1 row-start-1 text-center">{showB ? b : a}</span>
    </span>
  );
}

function EventsTab({
  projectId,
  issueId,
  repository,
}: {
  projectId: string;
  issueId: string;
  repository?: IssueRepository | null;
}) {
  const t = useTranslations("dashboard.issueDetail");
  const tl = useTranslations("dashboard.issues.level");
  const [selected, setSelected] = React.useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["issue-events", projectId, issueId],
    queryFn: () => api.issues.events(projectId, issueId, { limit: 50 }),
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["event", projectId, selected],
    queryFn: () => api.issues.event(projectId, selected as string),
    enabled: !!selected,
  });

  if (selected) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          {t("backToEvents")}
        </button>
        {detailLoading || !detail ? (
          <div className="h-40 animate-shimmer rounded-[var(--radius)]" />
        ) : (
          <EventDetailBody data={detail.data} repository={repository} />
        )}
      </div>
    );
  }

  const events = data?.results ?? [];

  if (isLoading) {
    return <div className="h-40 animate-shimmer rounded-[var(--radius)]" />;
  }
  if (events.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">{t("eventsEmpty")}</Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH>{t("eventTime")}</TH>
            <TH className="hidden lg:table-cell">{t("eventClient")}</TH>
            <TH className="hidden sm:table-cell">{t("eventEnvironment")}</TH>
            <TH className="hidden md:table-cell">{t("eventRelease")}</TH>
            <TH>{t("eventMessage")}</TH>
          </TR>
        </THead>
        <TBody>
          {events.map((ev) => {
            const id = ev.event_id ?? ev.id;
            return (
              <TR key={id} className="cursor-pointer" onClick={() => id && setSelected(id)}>
                <TD className="whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    {ev.level && <LevelBadge level={ev.level} label={tl(ev.level)} />}
                    <RelativeTime date={ev.received_at ?? ev.timestamp ?? ""} />
                  </div>
                </TD>
                <TD className="hidden lg:table-cell">
                  <EventClient contexts={ev.data?.contexts} />
                </TD>
                <TD className="hidden text-muted-foreground sm:table-cell">
                  {ev.environment || "—"}
                </TD>
                <TD className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                  {ev.release || "—"}
                </TD>
                <TD className="max-w-xs truncate font-mono text-xs" dir="ltr">
                  {ev.message || ev.data?.exception?.values?.[0]?.value || "—"}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </Card>
  );
}

/** Browser (name + version, shown separately), OS and device family for an event. */
function EventClient({ contexts }: { contexts?: EventContexts }) {
  const browser = contexts?.browser;
  const os = contexts?.os;
  const device = contexts?.device;
  const osLabel = [os?.name, os?.version].filter(Boolean).join(" ");
  const sub = [osLabel, device?.family as string | undefined].filter(Boolean).join(" · ");

  if (!browser?.name && !sub) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="text-xs" dir="ltr">
      {browser?.name && (
        <div className="font-medium">
          {browser.name}
          {browser.version ? (
            <span className="ms-1 text-muted-foreground">{String(browser.version)}</span>
          ) : null}
        </div>
      )}
      {sub && <div className="text-muted-foreground">{sub}</div>}
    </div>
  );
}

function CommentsTab({ projectId, issueId }: { projectId: string; issueId: string }) {
  const t = useTranslations("dashboard.issueDetail");
  const qc = useQueryClient();
  const [body, setBody] = React.useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["issue-comments", projectId, issueId],
    queryFn: () => api.issues.comments(projectId, issueId),
  });
  const comments = data ? unwrapList(data) : [];

  const add = useMutation({
    mutationFn: () => api.issues.addComment(projectId, issueId, body.trim()),
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({
        queryKey: ["issue-comments", projectId, issueId],
      });
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) add.mutate();
        }}
        className="space-y-2"
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("commentPlaceholder")}
          rows={3}
          className="flex w-full rounded-[var(--radius-sm)] border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={add.isPending} disabled={!body.trim()}>
            <Send className="h-4 w-4" />
            {t("commentSubmit")}
          </Button>
        </div>
      </form>

      {isLoading ? (
        <div className="h-24 animate-shimmer rounded-[var(--radius)]" />
      ) : comments.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">{t("commentsEmpty")}</Card>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">
                  {c.author_name || t("commentAnonymous")}
                </span>
                <span className="text-xs text-muted-foreground">
                  <RelativeTime date={c.created_at} />
                </span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground">{c.body}</p>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}

function DetailsTab({
  data,
  repository,
}: {
  data?: EventData;
  repository?: IssueRepository | null;
}) {
  const t = useTranslations("dashboard.issueDetail");
  if (!data) {
    return <Card className="p-6 text-sm text-muted-foreground">{t("noStacktrace")}</Card>;
  }
  return <EventDetailBody data={data} repository={repository} />;
}

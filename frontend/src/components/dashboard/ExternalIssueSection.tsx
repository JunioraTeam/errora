"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, GitlabIcon, Link2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Input";
import { Tabs } from "@/components/ui/Tabs";
import { ApiError, api } from "@/lib/api";
import { safeExternalUrl } from "@/lib/repoLinks";
import type { IssueDetail, Repository } from "@/lib/types";

export function ExternalIssueSection({
  projectId,
  issue,
}: {
  projectId: string;
  issue: IssueDetail;
}) {
  const t = useTranslations("dashboard.issueDetail.tracker");
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);

  const { data: repos } = useQuery({
    queryKey: ["issue-repos", projectId, issue.id],
    queryFn: () => api.issues.repositories(projectId, issue.id),
  });
  const { data: links } = useQuery({
    queryKey: ["issue-external", projectId, issue.id],
    queryFn: () => api.issues.externalIssues(projectId, issue.id),
  });

  // No source provider connected → nothing to track against.
  if (!repos || repos.length === 0) return null;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <GitlabIcon className="h-3.5 w-3.5" />
          {t("title")}
        </h3>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          {t("add")}
        </Button>
      </div>

      {links && links.length > 0 ? (
        <ul className="space-y-1.5">
          {links.map((l) => (
            <li key={l.id} className="flex items-center gap-2 text-sm">
              <Badge variant="muted" className="font-mono">
                {l.repository_name}#{l.external_id}
              </Badge>
              <a
                href={safeExternalUrl(l.web_url) ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 truncate text-accent hover:underline"
              >
                <span className="truncate">{l.title || l.web_url}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}

      <TrackerDialog
        open={open}
        onClose={() => setOpen(false)}
        projectId={projectId}
        issue={issue}
        repos={repos}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ["issue-external", projectId, issue.id] });
          setOpen(false);
        }}
      />
    </Card>
  );
}

function TrackerDialog({
  open,
  onClose,
  projectId,
  issue,
  repos,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  issue: IssueDetail;
  repos: Repository[];
  onDone: () => void;
}) {
  const t = useTranslations("dashboard.issueDetail.tracker");
  const [tab, setTab] = React.useState("create");

  return (
    <Dialog open={open} onClose={onClose} title={t("dialogTitle")}>
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "create", label: t("createTab") },
          { value: "link", label: t("linkTab") },
        ]}
      />
      <div className="mt-4">
        {tab === "create" ? (
          <CreateTab projectId={projectId} issue={issue} repos={repos} onDone={onDone} />
        ) : (
          <LinkTab projectId={projectId} issue={issue} repos={repos} onDone={onDone} />
        )}
      </div>
    </Dialog>
  );
}

function defaultTitle(issue: IssueDetail): string {
  return issue.value ? `${issue.type}: ${issue.value}` : issue.type || issue.title;
}

function defaultDescription(issue: IssueDetail): string {
  const url = typeof window !== "undefined" ? window.location.href : "";
  const lines = [
    issue.culprit ? `**${issue.culprit}**` : "",
    issue.value ? "```\n" + issue.value + "\n```" : "",
    url ? `\nReported by Errora: ${url}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

function CreateTab({
  projectId,
  issue,
  repos,
  onDone,
}: {
  projectId: string;
  issue: IssueDetail;
  repos: Repository[];
  onDone: () => void;
}) {
  const t = useTranslations("dashboard.issueDetail.tracker");
  const tc = useTranslations("common");
  const [repository, setRepository] = React.useState(repos[0]?.id ?? "");
  const [title, setTitle] = React.useState(defaultTitle(issue));
  const [description, setDescription] = React.useState(defaultDescription(issue));

  const mut = useMutation({
    mutationFn: () =>
      api.issues.createExternalIssue(projectId, issue.id, { repository, title, description }),
    onSuccess: onDone,
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (repository && title.trim()) mut.mutate();
      }}
      className="space-y-4"
    >
      <RepoSelect repos={repos} value={repository} onChange={setRepository} label={t("repository")} />
      <Field label={t("issueTitle")} htmlFor="tracker-title">
        <Input id="tracker-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={t("description")} htmlFor="tracker-desc">
        <textarea
          id="tracker-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          dir="ltr"
          className="flex w-full rounded-[var(--radius-sm)] border border-border bg-input px-3 py-2 font-mono text-xs text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        />
      </Field>
      {mut.isError && <ErrorLine error={mut.error} />}
      <div className="flex justify-end">
        <Button type="submit" loading={mut.isPending} disabled={!repository || !title.trim()}>
          <Plus className="h-4 w-4" />
          {t("createSubmit")}
        </Button>
      </div>
    </form>
  );
}

function LinkTab({
  projectId,
  issue,
  repos,
  onDone,
}: {
  projectId: string;
  issue: IssueDetail;
  repos: Repository[];
  onDone: () => void;
}) {
  const t = useTranslations("dashboard.issueDetail.tracker");
  const [repository, setRepository] = React.useState(repos[0]?.id ?? "");
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [picked, setPicked] = React.useState<string | null>(null);
  const [comment, setComment] = React.useState("");

  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(q), 350);
    return () => clearTimeout(id);
  }, [q]);

  const { data, isFetching } = useQuery({
    queryKey: ["tracker-search", projectId, issue.id, repository, debounced],
    queryFn: () => api.issues.searchExternalIssues(projectId, issue.id, repository, debounced),
    enabled: !!repository,
  });
  const results = data?.results ?? [];

  const mut = useMutation({
    mutationFn: () =>
      api.issues.linkExternalIssue(projectId, issue.id, {
        repository,
        external_id: picked as string,
        comment: comment.trim() || undefined,
      }),
    onSuccess: onDone,
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (repository && picked) mut.mutate();
      }}
      className="space-y-4"
    >
      <RepoSelect
        repos={repos}
        value={repository}
        onChange={(v) => {
          setRepository(v);
          setPicked(null);
        }}
        label={t("repository")}
      />
      <Field label={t("searchIssues")} htmlFor="tracker-search">
        <Input
          id="tracker-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          dir="ltr"
        />
      </Field>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-[var(--radius-sm)] border border-border p-1">
        {isFetching ? (
          <div className="h-8 animate-shimmer rounded" />
        ) : results.length === 0 ? (
          <p className="px-2 py-3 text-center text-sm text-muted-foreground">{t("noResults")}</p>
        ) : (
          results.map((r) => (
            <button
              key={r.iid}
              type="button"
              onClick={() => setPicked(r.iid)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm transition-colors hover:bg-muted ${
                picked === r.iid ? "bg-accent-soft" : ""
              }`}
            >
              <Badge variant="muted" className="font-mono">
                #{r.iid}
              </Badge>
              <span className="min-w-0 truncate" dir="ltr">
                {r.title}
              </span>
            </button>
          ))
        )}
      </div>
      <Field label={t("comment")} htmlFor="tracker-comment">
        <Input
          id="tracker-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t("commentPlaceholder")}
        />
      </Field>
      {mut.isError && <ErrorLine error={mut.error} />}
      <div className="flex justify-end">
        <Button type="submit" loading={mut.isPending} disabled={!repository || !picked}>
          <Link2 className="h-4 w-4" />
          {t("linkSubmit")}
        </Button>
      </div>
    </form>
  );
}

function RepoSelect({
  repos,
  value,
  onChange,
  label,
}: {
  repos: Repository[];
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <Field label={label} htmlFor="tracker-repo">
      <Select id="tracker-repo" value={value} onChange={(e) => onChange(e.target.value)}>
        {repos.map((r) => (
          <option key={r.id} value={r.id}>
            {r.path_with_namespace}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function ErrorLine({ error }: { error: unknown }) {
  const t = useTranslations("dashboard.issueDetail.tracker");
  const detail =
    error instanceof ApiError && error.body && typeof error.body === "object" && "detail" in error.body
      ? String((error.body as { detail: unknown }).detail)
      : t("error");
  return <p className="text-sm text-danger">{detail}</p>;
}

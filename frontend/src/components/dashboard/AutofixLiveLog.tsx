"use client";

import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { API_PREFIX, api } from "@/lib/api";
import { safeExternalUrl } from "@/lib/repoLinks";
import type { AutofixRunStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type Snapshot = {
  id: string;
  status: AutofixRunStatus;
  explanation?: string;
  error?: string;
  mr_url?: string;
};

const STEPS: AutofixRunStatus[] = ["queued", "analyzing", "generating", "creating_mr", "completed"];

/**
 * Live AI-fix log via Server-Sent Events. Streams a single run's status/logs as
 * they change and stops when the run finishes.
 */
export function AutofixLiveLog({
  projectId,
  issueId,
  runId,
  onDone,
}: {
  projectId: string;
  issueId: string;
  runId: string;
  onDone?: () => void;
}) {
  const t = useTranslations("dashboard.aiFixes");
  const td = useTranslations("dashboard.issueDetail");
  const [snap, setSnap] = React.useState<Snapshot | null>(null);
  const doneRef = React.useRef(onDone);
  doneRef.current = onDone;

  React.useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    // Mint a short-lived, run-scoped stream token (the long-lived access token
    // must never go in a URL — it would leak to logs/history/Referer).
    api.issues
      .autofixStreamTicket(projectId, issueId, runId)
      .then(({ token }) => {
        if (cancelled) return;
        es = new EventSource(
          `${API_PREFIX}/autofix-runs/${runId}/stream?token=${encodeURIComponent(token)}`
        );
        es.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data?.status) setSnap(data);
          } catch {
            /* ignore keep-alive / malformed frames */
          }
        };
        es.addEventListener("done", () => {
          es?.close();
          doneRef.current?.();
        });
        // Leave onerror unset: a transient blip lets EventSource auto-reconnect
        // (the stream token outlives the run window), instead of dying silently.
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      es?.close();
    };
  }, [runId, projectId, issueId]);

  if (!snap) return null;
  const failed = snap.status === "failed";
  const activeIdx = STEPS.indexOf(failed ? "creating_mr" : snap.status);

  return (
    <Card className="mt-4 p-4">
      <div className="flex items-center gap-2">
        {snap.status !== "completed" && !failed && (
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        )}
        <span className="text-sm font-semibold">{td("autofixLive")}</span>
        <Badge variant={failed ? "danger" : snap.status === "completed" ? "success" : "accent"}>
          {t(`status.${snap.status}`)}
        </Badge>
      </div>

      <ol className="mt-3 flex flex-wrap gap-1.5 text-xs">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={cn(
              "rounded-full px-2 py-0.5",
              i <= activeIdx && !failed
                ? "bg-accent-soft text-accent"
                : "bg-muted text-muted-foreground"
            )}
          >
            {t(`status.${s}`)}
          </li>
        ))}
      </ol>

      {snap.explanation && <p className="mt-3 whitespace-pre-wrap text-sm">{snap.explanation}</p>}
      {snap.error && (
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-[var(--radius-sm)] bg-danger/10 p-2 font-mono text-xs text-danger">
          {snap.error}
        </pre>
      )}
      {safeExternalUrl(snap.mr_url) && (
        <a
          href={safeExternalUrl(snap.mr_url) as string}
          target="_blank"
          rel="noreferrer"
          dir="ltr"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
        >
          <ExternalLink className="h-4 w-4" />
          {t("viewMr")}
        </a>
      )}
    </Card>
  );
}

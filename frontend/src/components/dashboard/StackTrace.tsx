"use client";

import { Check, ChevronDown, Copy, ExternalLink, FileCode } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Collapsible } from "@/components/ui/Collapsible";
import { type Lang, langForPlatform } from "@/lib/highlight";
import { blameUrl, providerLabel } from "@/lib/repoLinks";
import type { ExceptionValue, IssueRepository, StackFrame } from "@/lib/types";
import { cn } from "@/lib/utils";

// Cap how many frames mount at once — a pathological trace with hundreds of
// frames would otherwise tokenize every context line up front.
const MAX_FRAMES = 40;

export function StackTrace({
  exception,
  platform,
  repository,
}: {
  exception: ExceptionValue;
  platform?: string;
  repository?: IssueRepository | null;
}) {
  const t = useTranslations("dashboard.issueDetail");
  const frames = exception.stacktrace?.frames ?? [];
  const lang = langForPlatform(platform);
  const [showAll, setShowAll] = React.useState(false);

  // Sentry convention: frames are oldest-first; show most-recent (crash) on top.
  const ordered = [...frames].reverse();
  const shown = showAll ? ordered : ordered.slice(0, MAX_FRAMES);
  const hidden = ordered.length - shown.length;

  if (ordered.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("noStacktrace")}</p>;
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-border">
      <div className="border-b border-border bg-muted px-4 py-2.5 font-mono text-sm">
        <span className="font-semibold text-[var(--level-error)]">{exception.type}</span>
        {exception.value ? (
          <span className="break-words text-muted-foreground">: {exception.value}</span>
        ) : null}
      </div>
      <Collapsible collapsedHeight={420} buttonClassName="px-4 pb-3">
        <ul className="divide-y divide-border">
          {shown.map((frame, i) => (
            <Frame
              key={i}
              frame={frame}
              lang={lang}
              repository={repository}
              defaultOpen={i === 0 && !!frame.in_app}
            />
          ))}
        </ul>
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="w-full border-t border-border px-4 py-2.5 text-start text-xs font-medium text-accent hover:bg-muted/50"
          >
            {t("framesMore", { count: hidden })}
          </button>
        )}
      </Collapsible>
    </div>
  );
}

function FrameAction({
  onClick,
  href,
  title,
  children,
}: {
  onClick?: () => void;
  href?: string;
  title: string;
  children: React.ReactNode;
}) {
  const cls =
    "inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title={title}
        aria-label={title}
        className={cls}
      >
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} className={cls}>
      {children}
    </button>
  );
}

function Frame({
  frame,
  lang,
  repository,
  defaultOpen,
}: {
  frame: StackFrame;
  lang: Lang;
  repository?: IssueRepository | null;
  defaultOpen: boolean;
}) {
  const t = useTranslations("dashboard.issueDetail");
  const hasContext =
    !!frame.context_line ||
    (frame.pre_context?.length ?? 0) > 0 ||
    (frame.post_context?.length ?? 0) > 0;
  const [open, setOpen] = React.useState(defaultOpen && hasContext);
  const [copied, setCopied] = React.useState(false);

  const path = frame.filename || frame.abs_path || "";
  const repoUrl = repository ? blameUrl(repository, frame) : null;

  function copyPath() {
    navigator.clipboard?.writeText(path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <li className={cn("group/frame", frame.in_app ? "bg-card" : "bg-card/40")}>
      <div className="flex items-start gap-2 px-4 py-2.5 font-mono text-sm">
        <button
          type="button"
          onClick={() => hasContext && setOpen((o) => !o)}
          className={cn(
            "flex min-w-0 flex-1 items-start gap-2 text-start",
            hasContext && "cursor-pointer"
          )}
        >
          <FileCode
            className={cn(
              "mt-0.5 h-4 w-4 shrink-0",
              frame.in_app ? "text-accent" : "text-muted-foreground"
            )}
          />
          <span className="min-w-0 flex-1 break-all" dir="ltr">
            <span className={cn(frame.in_app ? "text-foreground" : "text-muted-foreground")}>
              {frame.filename}
            </span>
            {frame.lineno != null && (
              <span className="text-muted-foreground">
                :{frame.lineno}
                {frame.colno != null ? `:${frame.colno}` : ""}
              </span>
            )}
            {frame.function && <span className="text-accent"> in {frame.function}</span>}
          </span>
          {hasContext && (
            <ChevronDown
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180"
              )}
            />
          )}
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {frame.symbolicated && (
            <span
              title={t("symbolicatedHint")}
              className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success"
            >
              {t("symbolicated")}
            </span>
          )}
          {frame.in_app && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">
              {t("inApp")}
            </span>
          )}
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/frame:opacity-100 focus-within:opacity-100">
            {path && (
              <FrameAction onClick={copyPath} title={t("copyFilePath")}>
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </FrameAction>
            )}
            {repoUrl && (
              <FrameAction
                href={repoUrl}
                title={t("openLineIn", { provider: providerLabel(repository?.provider) })}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </FrameAction>
            )}
          </div>
        </div>
      </div>

      {open && hasContext && (
        <div className="border-t border-border bg-background-elevated">
          <ContextLines frame={frame} lang={lang} />
        </div>
      )}
    </li>
  );
}

function ContextLines({ frame, lang }: { frame: StackFrame; lang: Lang }) {
  const startLine = frame.lineno != null ? frame.lineno - (frame.pre_context?.length ?? 0) : null;

  const lines: Array<{ no: number | null; text: string; current: boolean }> = [];

  (frame.pre_context ?? []).forEach((text, idx) => {
    lines.push({ no: startLine != null ? startLine + idx : null, text, current: false });
  });
  if (frame.context_line != null) {
    lines.push({ no: frame.lineno ?? null, text: frame.context_line, current: true });
  }
  (frame.post_context ?? []).forEach((text, idx) => {
    lines.push({ no: frame.lineno != null ? frame.lineno + idx + 1 : null, text, current: false });
  });

  return (
    <div className="overflow-x-auto font-mono text-xs leading-relaxed" dir="ltr">
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn("flex gap-3 px-4 py-0.5", line.current && "bg-[var(--level-error)]/10")}
        >
          <span className="w-10 shrink-0 select-none text-end text-muted-foreground">
            {line.no ?? ""}
          </span>
          <CodeBlock
            code={line.text || " "}
            lang={lang}
            wrap
            className={cn("min-w-0 flex-1 text-xs", line.current && "font-medium")}
          />
        </div>
      ))}
    </div>
  );
}

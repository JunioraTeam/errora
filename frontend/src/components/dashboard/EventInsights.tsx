"use client";

import {
  Check,
  ChevronDown,
  Copy,
  Database,
  Fingerprint,
  GitCommit,
  Globe,
  Package,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { StackTrace } from "@/components/dashboard/StackTrace";
import { TechIcon } from "@/components/dashboard/TechIcon";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Collapsible } from "@/components/ui/Collapsible";
import { Input, Select } from "@/components/ui/Input";
import { formatDateTime } from "@/lib/datetime";
import { blameUrl } from "@/lib/repoLinks";
import type {
  Breadcrumb,
  EventContexts,
  EventData,
  ExceptionValue,
  IssueRepository,
  StackFrame,
} from "@/lib/types";
import { cn, localizeDigits } from "@/lib/utils";

// --- shared helpers ------------------------------------------------------- //

type PairInput = Array<[string, string]> | Record<string, string> | undefined;

function toPairs(input: PairInput): Array<[string, string]> {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  return Object.entries(input);
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

function SectionTitle({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {icon}
      {children}
    </h3>
  );
}

function KeyVal({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <dt className="shrink-0 text-muted-foreground">{k}</dt>
      <dd
        className={cn("min-w-0 break-words sm:truncate text-end", mono && "font-mono text-xs")}
        dir={mono ? "ltr" : undefined}
        title={typeof v === "string" ? v : undefined}
      >
        {v}
      </dd>
    </div>
  );
}

// --- event metadata strip ------------------------------------------------- //

export function EventMeta({ data }: { data: EventData }) {
  const t = useTranslations("dashboard.issueDetail");
  const mech = data.exception?.values?.at(-1)?.mechanism;
  const handled = mech?.handled;

  const items: Array<[string, string | undefined]> = [
    [t("eventId"), data.event_id],
    [t("transactionLabel"), data.transaction],
    [t("environment"), data.environment],
    [t("release"), data.release],
    [t("dist"), data.dist],
    [t("serverName"), data.server_name],
  ];
  const present = items.filter(([, v]) => v);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        {handled === false && <Badge variant="danger">{t("unhandled")}</Badge>}
        {handled === true && <Badge variant="muted">{t("handled")}</Badge>}
        {mech?.type && (
          <Badge variant="outline" className="font-mono">
            {t("mechanism")}: {mech.type}
          </Badge>
        )}
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {present.map(([k, v]) => (
          <KeyVal key={k} k={k} v={v} mono={k === t("eventId")} />
        ))}
      </dl>
    </Card>
  );
}

// --- suspect commit ------------------------------------------------------- //

function topInAppFrame(exceptions: ExceptionValue[]): StackFrame | null {
  // Sentry orders frames oldest→newest, so the crash site is the last in-app
  // frame; fall back to the last frame of the last exception.
  const frames = exceptions.at(-1)?.stacktrace?.frames ?? [];
  if (frames.length === 0) return null;
  const inApp = frames.filter((f) => f.in_app);
  return (inApp.length ? inApp.at(-1) : frames.at(-1)) ?? null;
}

export function SuspectCommit({
  exceptions,
  repository,
}: {
  exceptions: ExceptionValue[];
  repository?: IssueRepository | null;
}) {
  const t = useTranslations("dashboard.issueDetail");
  const locale = useLocale();
  const frame = topInAppFrame(exceptions);
  if (!frame) return null;
  const url = repository ? blameUrl(repository, frame) : null;

  return (
    <Card className="border-accent/40 bg-accent-soft/30 p-4">
      <SectionTitle icon={<GitCommit className="h-3.5 w-3.5" />}>{t("suspect")}</SectionTitle>
      <p className="mb-2 text-xs text-muted-foreground">{t("suspectDesc")}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 font-mono text-sm" dir="ltr">
          {frame.function && (
            <span className="block break-all sm:truncate font-semibold">{frame.function}</span>
          )}
          <span className="block break-all sm:truncate text-xs text-muted-foreground">
            {frame.filename}
            {frame.lineno ? `:${localizeDigits(frame.lineno, locale)}` : ""}
          </span>
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-[var(--radius-sm)] border border-border bg-card px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
          >
            {t("viewInRepo")}
          </a>
        )}
      </div>
    </Card>
  );
}

// --- contexts (browser/os/runtime/device/trace) --------------------------- //

const CONTEXT_KEYS = ["browser", "os", "runtime", "device"] as const;

export function ContextsCard({ contexts }: { contexts?: EventContexts }) {
  const t = useTranslations("dashboard.issueDetail");
  if (!contexts) return null;
  const blocks = CONTEXT_KEYS.filter((k) => contexts[k]);
  const trace = contexts.trace;
  if (blocks.length === 0 && !trace) return null;

  return (
    <Card className="p-4">
      <SectionTitle>{t("contexts")}</SectionTitle>
      <div className="space-y-3">
        {blocks.map((key) => {
          const ctx = contexts[key] as Record<string, unknown>;
          const rows = Object.entries(ctx).filter(
            ([k, v]) => k !== "type" && typeof v !== "object" && v != null && v !== ""
          );
          const techName = String(ctx.name ?? ctx.model ?? ctx.family ?? "");
          return (
            <div key={key}>
              <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold capitalize">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                  <TechIcon name={techName} className="h-5 w-5" />
                </span>
                {t(`ctx.${key}`)}
              </div>
              <dl className="rounded-[var(--radius-sm)] bg-muted/40 px-3 py-1.5">
                {rows.map(([k, v]) => (
                  <KeyVal key={k} k={k} v={String(v)} mono />
                ))}
              </dl>
            </div>
          );
        })}
        {trace && (
          <div>
            <div className="mb-1 text-xs font-semibold">{t("ctx.trace")}</div>
            <dl className="rounded-[var(--radius-sm)] bg-muted/40 px-3 py-1.5">
              {trace.op && <KeyVal k="op" v={trace.op} mono />}
              {trace.status && <KeyVal k="status" v={trace.status} mono />}
              {trace.trace_id && <KeyVal k="trace_id" v={trace.trace_id} mono />}
            </dl>
          </div>
        )}
      </div>
    </Card>
  );
}

// --- HTTP request (formatted + copy as curl) ------------------------------ //

export function HttpRequestCard({ request }: { request: EventData["request"] }) {
  const t = useTranslations("dashboard.issueDetail");
  if (!request || (!request.url && !request.method)) return null;
  const headers = toPairs(request.headers);
  const referrer = headers.find(([k]) => /^referr?er$/i.test(k))?.[1];

  const curl = [
    `curl -X ${request.method || "GET"} '${request.url || ""}'`,
    ...headers.map(([k, v]) => `  -H '${k}: ${String(v).replace(/'/g, "'\\''")}'`),
  ].join(" \\\n");

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle icon={<Globe className="h-3.5 w-3.5" />}>{t("request")}</SectionTitle>
        <CopyButton text={curl} label={t("copyAsCurl")} />
      </div>
      <div className="mb-2 flex items-center gap-2 font-mono text-sm" dir="ltr">
        {request.method && <Badge variant="accent">{request.method}</Badge>}
        <span className="min-w-0 break-all text-muted-foreground">{request.url}</span>
      </div>
      {referrer && (
        <div className="mb-3 flex items-baseline gap-2 text-xs" dir="ltr">
          <span className="shrink-0 text-muted-foreground">{t("referrer")}</span>
          <span className="min-w-0 break-all font-mono text-muted-foreground">{referrer}</span>
        </div>
      )}
      {headers.length > 0 && (
        <div
          className="divide-y divide-border overflow-hidden rounded-[var(--radius-sm)] border border-border text-xs"
          dir="ltr"
        >
          {headers.map(([k, v]) => (
            <div key={k} className="flex flex-col sm:flex-row">
              <div className="shrink-0 break-all bg-muted/40 px-3 py-1.5 font-mono font-medium sm:w-44">
                {k}
              </div>
              <div className="min-w-0 break-all px-3 py-1.5 font-mono text-muted-foreground">
                {String(v)}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// --- breadcrumbs ---------------------------------------------------------- //

function isSql(b: Breadcrumb): boolean {
  const c = (b.category || "").toLowerCase();
  return c.includes("sql") || c.includes("query");
}

function crumbCategory(b: Breadcrumb): string {
  return b.category || b.type || "default";
}

type HttpInfo = { method: string; url: string; status?: number };

/**
 * HTTP-client breadcrumbs (e.g. Laravel's outgoing `Http::` calls) arrive with
 * category "http" and method/url/status in `data` (flat or dotted keys, varying
 * by SDK version) — surface them as method + URL + status.
 */
function httpInfo(b: Breadcrumb): HttpInfo | null {
  if (!(b.category || "").toLowerCase().includes("http")) return null;
  const d = (b.data ?? {}) as Record<string, unknown>;
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = d[k];
      if (v != null && v !== "") return v;
    }
    return undefined;
  };
  const method = get("method", "http.request.method", "http.method");
  const url = get("url", "http.url", "http.request.url");
  const status = get("status_code", "http.response.status_code", "status");
  if (!url && !method) return null;
  return {
    method: method ? String(method).toUpperCase() : "",
    url: url ? String(url) : "",
    status: status != null ? Number(status) : undefined,
  };
}

function BreadcrumbRow({ b, locale }: { b: Breadcrumb; locale: string }) {
  const t = useTranslations("dashboard.issueDetail");
  const took = b.data?.executionTimeMs;
  const bindings = b.data?.bindings as unknown[] | undefined;
  const when = typeof b.timestamp === "number" ? formatDateTime(b.timestamp * 1000, locale) : null;
  const http = httpInfo(b);
  return (
    <li className="flex gap-3 py-2">
      <span
        className={cn(
          "mt-1 h-2 w-2 shrink-0 rounded-full",
          b.level === "error" || b.level === "fatal"
            ? "bg-danger"
            : b.level === "warning"
              ? "bg-[var(--level-warning)]"
              : "bg-muted-foreground/50"
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="muted" className="font-mono">
              {crumbCategory(b)}
            </Badge>
            {typeof took === "number" && (
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {localizeDigits(took.toFixed(2), locale)}ms
              </span>
            )}
          </div>
          {when && (
            <time className="shrink-0 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
              {when}
            </time>
          )}
        </div>
        {b.message &&
          (isSql(b) ? (
            <CodeBlock code={b.message} lang="sql" className="mt-1" />
          ) : (
            <p className="mt-1 break-words text-sm">{b.message}</p>
          ))}
        {http && (
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs" dir="ltr">
            {http.method && (
              <span className="rounded bg-muted px-1.5 py-0.5 font-semibold">{http.method}</span>
            )}
            <span className="min-w-0 truncate text-muted-foreground">{http.url}</span>
            {http.status != null && !Number.isNaN(http.status) && (
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 font-semibold",
                  http.status >= 500
                    ? "bg-danger/15 text-danger"
                    : http.status >= 400
                      ? "bg-[var(--level-warning)]/15 text-[var(--level-warning)]"
                      : "bg-success/15 text-success"
                )}
              >
                {http.status}
              </span>
            )}
          </div>
        )}
        {bindings && bindings.length > 0 && (
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground" dir="ltr">
            {t("bindings")}: [{bindings.map((x) => JSON.stringify(x)).join(", ")}]
          </p>
        )}
      </div>
    </li>
  );
}

export function BreadcrumbsCard({ breadcrumbs }: { breadcrumbs?: Breadcrumb[] }) {
  const t = useTranslations("dashboard.issueDetail");
  const locale = useLocale();
  const [q, setQ] = React.useState("");
  const [cat, setCat] = React.useState("");
  const [order, setOrder] = React.useState<"oldest" | "newest">("oldest");

  const categories = React.useMemo(() => {
    const s = new Set<string>();
    for (const b of breadcrumbs ?? []) s.add(crumbCategory(b));
    return [...s].sort();
  }, [breadcrumbs]);

  const items = React.useMemo(() => {
    let list = (breadcrumbs ?? []).map((b, i) => ({ b, i }));
    if (cat) list = list.filter(({ b }) => crumbCategory(b) === cat);
    if (q) {
      const ql = q.toLowerCase();
      list = list.filter(
        ({ b }) =>
          (b.message || "").toLowerCase().includes(ql) ||
          crumbCategory(b).toLowerCase().includes(ql)
      );
    }
    return [...list].sort((a, z) =>
      order === "oldest"
        ? (a.b.timestamp ?? a.i) - (z.b.timestamp ?? z.i)
        : (z.b.timestamp ?? z.i) - (a.b.timestamp ?? a.i)
    );
  }, [breadcrumbs, cat, q, order]);

  if (!breadcrumbs || breadcrumbs.length === 0) return null;

  return (
    <Card className="p-4">
      <SectionTitle icon={<Database className="h-3.5 w-3.5" />}>{t("breadcrumbs")}</SectionTitle>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("breadcrumbSearch")}
          className="flex-1 text-xs"
        />
        <Select
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          aria-label={t("breadcrumbCategory")}
          className="text-xs sm:w-40"
        >
          <option value="">{t("breadcrumbAll")}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select
          value={order}
          onChange={(e) => setOrder(e.target.value as "oldest" | "newest")}
          aria-label={t("breadcrumbSort")}
          className="text-xs sm:w-32"
        >
          <option value="oldest">{t("breadcrumbOldest")}</option>
          <option value="newest">{t("breadcrumbNewest")}</option>
        </Select>
      </div>
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t("breadcrumbNoMatch")}</p>
      ) : (
        <Collapsible collapsedHeight={360}>
          <ol className="divide-y divide-border">
            {items.map(({ b, i }) => (
              <BreadcrumbRow key={i} b={b} locale={locale} />
            ))}
          </ol>
        </Collapsible>
      )}
    </Card>
  );
}

// --- packages / modules --------------------------------------------------- //

export function PackagesCard({ modules }: { modules?: Record<string, string> }) {
  const t = useTranslations("dashboard.issueDetail");
  const locale = useLocale();
  const [q, setQ] = React.useState("");
  const [expanded, setExpanded] = React.useState(false);
  const entries = React.useMemo(() => Object.entries(modules ?? {}).sort(), [modules]);
  if (entries.length === 0) return null;

  const filtered = q ? entries.filter(([k]) => k.toLowerCase().includes(q.toLowerCase())) : entries;
  const shown = expanded || q ? filtered : filtered.slice(0, 8);

  return (
    <Card className="p-4">
      <SectionTitle icon={<Package className="h-3.5 w-3.5" />}>
        {t("packages")} ({localizeDigits(entries.length, locale)})
      </SectionTitle>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("searchPackages")}
        className="mb-2 h-8 w-full rounded-[var(--radius-sm)] border border-border bg-input px-2.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        dir="ltr"
      />
      <dl className="max-h-64 space-y-px overflow-y-auto">
        {shown.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 text-xs" dir="ltr">
            <span className="min-w-0 break-all sm:truncate font-mono">{k}</span>
            <span className="shrink-0 font-mono text-muted-foreground">{v}</span>
          </div>
        ))}
      </dl>
      {!q && filtered.length > 8 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
        >
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
          />
          {expanded ? t("showLess") : t("showAll")}
        </button>
      )}
    </Card>
  );
}

// --- SDK ------------------------------------------------------------------ //

export function SdkCard({ sdk }: { sdk?: EventData["sdk"] }) {
  const t = useTranslations("dashboard.issueDetail");
  if (!sdk?.name) return null;
  return (
    <Card className="p-4">
      <SectionTitle>{t("sdk")}</SectionTitle>
      <dl>
        <KeyVal k={sdk.name} v={sdk.version ?? "—"} mono />
        {sdk.packages?.map((p) => (
          <KeyVal key={p.name} k={p.name} v={p.version} mono />
        ))}
      </dl>
    </Card>
  );
}

// --- grouping information ------------------------------------------------- //

export function GroupingCard({ grouping }: { grouping?: EventData["_grouping"] }) {
  const t = useTranslations("dashboard.issueDetail");
  if (!grouping?.hash) return null;
  return (
    <Card className="p-4">
      <SectionTitle icon={<Fingerprint className="h-3.5 w-3.5" />}>{t("grouping")}</SectionTitle>
      <dl>
        <KeyVal k={t("groupingHash")} v={grouping.hash} mono />
        {grouping.config && <KeyVal k={t("groupingConfig")} v={grouping.config} mono />}
      </dl>
      {grouping.components && grouping.components.length > 0 && (
        <div className="mt-2">
          <div className="mb-1 text-xs text-muted-foreground">{t("groupingComponents")}</div>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-[var(--radius-sm)] bg-muted/40 p-2 font-mono text-[11px]">
            {grouping.components.map((c, i) => (
              <li key={i} className="break-all sm:truncate" dir="ltr">
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// --- tags ----------------------------------------------------------------- //

export function TagsCard({ tags }: { tags: EventData["tags"] }) {
  const t = useTranslations("dashboard.issueDetail");
  const pairs = toPairs(tags);
  if (pairs.length === 0) return null;
  return (
    <Card className="p-4">
      <SectionTitle>{t("tags")}</SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        {pairs.map(([k, v]) => (
          <Badge key={k} variant="outline" className="max-w-full font-mono text-xs">
            <span className="text-muted-foreground">{k}</span>
            <span className="break-all sm:truncate text-foreground" dir="ltr" title={v}>
              {v}
            </span>
          </Badge>
        ))}
      </div>
    </Card>
  );
}

function UserCard({ user }: { user: NonNullable<EventData["user"]> }) {
  const t = useTranslations("dashboard.issueDetail");
  return (
    <Card className="p-4">
      <SectionTitle>{t("user")}</SectionTitle>
      <dl>
        {user.id && <KeyVal k="ID" v={user.id} mono />}
        {user.email && <KeyVal k="Email" v={user.email} mono />}
        {user.username && <KeyVal k="Username" v={user.username} mono />}
        {user.ip_address && <KeyVal k={t("ip")} v={user.ip_address} mono />}
      </dl>
    </Card>
  );
}

// --- full event body (shared by the Details tab + single-event view) ------ //

export function EventDetailBody({
  data,
  repository,
}: {
  data: EventData;
  repository?: IssueRepository | null;
}) {
  const t = useTranslations("dashboard.issueDetail");
  const exceptions = data.exception?.values ?? [];
  const user = data.user;
  const hasUser = !!user && (!!user.id || !!user.email || !!user.ip_address || !!user.username);

  return (
    <div className="space-y-6">
      <EventMeta data={data} />
      <SuspectCommit exceptions={exceptions} repository={repository} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <div className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t("stacktrace")}
            </h2>
            {exceptions.length === 0 ? (
              <Card className="p-6 text-sm text-muted-foreground">{t("noStacktrace")}</Card>
            ) : (
              exceptions.map((ex, i) => (
                <StackTrace
                  key={i}
                  exception={ex}
                  platform={data.platform}
                  repository={repository}
                />
              ))
            )}
          </div>

          {data.breadcrumbs && <BreadcrumbsCard breadcrumbs={data.breadcrumbs} />}
          {data.request && <HttpRequestCard request={data.request} />}
        </div>

        <aside className="space-y-5">
          <TagsCard tags={data.tags} />
          {data.contexts && <ContextsCard contexts={data.contexts} />}
          {hasUser && user && <UserCard user={user} />}
          {data.sdk && <SdkCard sdk={data.sdk} />}
          {data.modules && <PackagesCard modules={data.modules} />}
          {data._grouping && <GroupingCard grouping={data._grouping} />}
        </aside>
      </div>
    </div>
  );
}

"use client";

import { ChevronRight, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import type { Span } from "@/lib/types";
import { cn, formatDuration, localizeDigits } from "@/lib/utils";

const OP_COLORS = [
  "bg-accent",
  "bg-[var(--level-info)]",
  "bg-[var(--level-warning)]",
  "bg-success",
  "bg-danger",
  "bg-[var(--level-debug)]",
];

function opColor(op: string): string {
  let h = 0;
  for (const c of op) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return OP_COLORS[h % OP_COLORS.length];
}

function dataStr(d: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!d) return undefined;
  for (const k of keys) {
    const v = d[k];
    if (v != null && v !== "") return String(v);
  }
  return undefined;
}

function statusClass(status: string): string {
  const n = Number(status);
  if (n >= 500) return "bg-danger/15 text-danger";
  if (n >= 400) return "bg-[var(--level-warning)]/15 text-[var(--level-warning)]";
  if (n >= 200) return "bg-success/15 text-success";
  return "bg-muted text-muted-foreground";
}

function spanDesc(s: Span): string {
  return s.description || dataStr(s.data, "db.statement", "url", "http.url", "cache.key") || "";
}

type Node = { span: Span; depth: number; children: Node[] };

const ROW = "h-7";

/**
 * Span waterfall (trace view), Sentry-style: an expandable span tree on the
 * left and a time-axis waterfall on the right. The two columns scroll
 * horizontally on their own but share vertical scroll; clicking a span opens its
 * full data.
 */
export function SpanWaterfall({
  spans,
  total,
  rootSpanId,
  truncated,
  spanCount,
}: {
  spans: Span[];
  total: number;
  rootSpanId: string;
  truncated?: boolean;
  spanCount?: number;
}) {
  const t = useTranslations("dashboard.transactionDetail");
  const locale = useLocale();
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [selected, setSelected] = React.useState<Span | null>(null);

  const leftRef = React.useRef<HTMLDivElement>(null);
  const rightRef = React.useRef<HTMLDivElement>(null);
  const syncing = React.useRef(false);

  // Build the parent/child tree (chronological order), assign depths.
  const roots = React.useMemo(() => {
    const nodes = new Map<string, Node>();
    for (const s of spans) nodes.set(s.span_id, { span: s, depth: 0, children: [] });
    const tops: Node[] = [];
    for (const s of spans) {
      const node = nodes.get(s.span_id);
      if (!node) continue;
      const parent =
        s.parent_span_id && s.parent_span_id !== rootSpanId
          ? nodes.get(s.parent_span_id)
          : undefined;
      if (parent) parent.children.push(node);
      else tops.push(node);
    }
    const byStart = (a: Node, b: Node) => a.span.start_ms - b.span.start_ms;
    const sortRec = (n: Node, d: number) => {
      n.depth = d;
      n.children.sort(byStart);
      for (const c of n.children) sortRec(c, d + 1);
    };
    tops.sort(byStart);
    for (const n of tops) sortRec(n, 0);
    return tops;
  }, [spans, rootSpanId]);

  const visible = React.useMemo(() => {
    const out: Node[] = [];
    const walk = (n: Node) => {
      out.push(n);
      if (!collapsed.has(n.span.span_id)) for (const c of n.children) walk(c);
    };
    for (const r of roots) walk(r);
    return out;
  }, [roots, collapsed]);

  if (spans.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("noSpans")}</p>;
  }

  const denom = total > 0 ? total : 1;

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function syncScroll(from: "left" | "right") {
    if (syncing.current) return;
    syncing.current = true;
    const a = from === "left" ? leftRef.current : rightRef.current;
    const b = from === "left" ? rightRef.current : leftRef.current;
    if (a && b) b.scrollTop = a.scrollTop;
    syncing.current = false;
  }

  return (
    <div>
      {truncated && (
        <p className="mb-2 text-xs text-muted-foreground">
          {t("spansTruncated", {
            shown: localizeDigits(spans.length, locale),
            total: localizeDigits(spanCount ?? spans.length, locale),
          })}
        </p>
      )}

      <div className="flex max-h-[28rem] overflow-hidden rounded-[var(--radius)] border border-border">
        {/* Tree column */}
        <div
          ref={leftRef}
          onScroll={() => syncScroll("left")}
          className="w-1/2 shrink-0 overflow-auto border-e border-border"
        >
          <div className="min-w-max">
            {visible.map((n) => {
              const s = n.span;
              const hasChildren = n.children.length > 0;
              const open = !collapsed.has(s.span_id);
              const method = dataStr(s.data, "http.request.method", "http.method", "method");
              const status = dataStr(s.data, "http.response.status_code", "status_code", "status");
              const dbSystem = dataStr(s.data, "db.system");
              const cacheHit =
                typeof s.data?.["cache.hit"] === "boolean"
                  ? (s.data["cache.hit"] as boolean)
                  : null;
              return (
                <button
                  type="button"
                  key={s.span_id}
                  onClick={() => setSelected(s)}
                  className={cn(
                    "flex w-full items-center gap-1.5 whitespace-nowrap px-2 text-start text-xs transition-colors hover:bg-muted/60",
                    ROW,
                    selected?.span_id === s.span_id && "bg-accent-soft/50"
                  )}
                  style={{ paddingInlineStart: `${8 + n.depth * 14}px` }}
                >
                  {hasChildren ? (
                    <ChevronRight
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(s.span_id);
                      }}
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                        open && "rotate-90"
                      )}
                    />
                  ) : (
                    <span className="w-3.5 shrink-0" />
                  )}
                  <span
                    className={cn("h-2 w-2 shrink-0 rounded-full", opColor(s.op || "default"))}
                  />
                  <span className="shrink-0 font-mono font-medium">{s.op || "default"}</span>
                  {(method || status) && (
                    <span
                      className={cn(
                        "shrink-0 rounded px-1 font-mono text-[10px] font-semibold",
                        status ? statusClass(status) : "bg-muted text-muted-foreground"
                      )}
                    >
                      {[method, status].filter(Boolean).join(" ")}
                    </span>
                  )}
                  {dbSystem && (
                    <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                      {dbSystem}
                    </span>
                  )}
                  {cacheHit !== null && (
                    <span
                      className={cn(
                        "shrink-0 rounded px-1 text-[10px] font-semibold",
                        cacheHit ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                      )}
                    >
                      {cacheHit ? "hit" : "miss"}
                    </span>
                  )}
                  {spanDesc(s) && <span className="text-muted-foreground">{spanDesc(s)}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Waterfall column */}
        <div ref={rightRef} onScroll={() => syncScroll("right")} className="flex-1 overflow-auto">
          <div className="min-w-[28rem]" dir="ltr">
            {visible.map((n) => {
              const s = n.span;
              const left = Math.min(100, (s.start_ms / denom) * 100);
              const width = Math.max(0.5, Math.min(100 - left, (s.duration_ms / denom) * 100));
              const end = left + width;
              // Past this point the bar is too close to the right edge to fit the
              // label after it, so the label is pinned right (over the bar) with a
              // contrast pill instead.
              const labelInside = end > 80;
              return (
                <button
                  type="button"
                  key={s.span_id}
                  onClick={() => setSelected(s)}
                  className={cn(
                    "relative block w-full px-2 transition-colors hover:bg-muted/60",
                    ROW,
                    selected?.span_id === s.span_id && "bg-accent-soft/50"
                  )}
                >
                  {/* Inner track: all bar/label percentages are relative to THIS
                      padded box, so the bar can never overrun it. */}
                  <span className="absolute inset-x-2 top-1/2 h-3 -translate-y-1/2 rounded bg-muted/40">
                    <span
                      className={cn("absolute inset-y-0 rounded", opColor(s.op || "default"))}
                      style={{ left: `${left}%`, width: `max(2px, ${width}%)` }}
                    />
                    {labelInside ? (
                      <span className="absolute end-0 top-1/2 -translate-y-1/2 rounded bg-card/85 px-1 text-[10px] tabular-nums text-foreground">
                        {formatDuration(s.duration_ms, locale)}
                      </span>
                    ) : (
                      <span
                        className="absolute top-1/2 ms-1 -translate-y-1/2 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground"
                        style={{ left: `${end}%` }}
                      >
                        {formatDuration(s.duration_ms, locale)}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {selected && (
        <SpanDetail span={selected} locale={locale} t={t} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function SpanDetail({
  span,
  locale,
  t,
  onClose,
}: {
  span: Span;
  locale: string;
  t: ReturnType<typeof useTranslations>;
  onClose: () => void;
}) {
  const entries = Object.entries(span.data ?? {});
  return (
    <div className="mt-3 rounded-[var(--radius)] border border-border bg-muted/20 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="min-w-0 truncate font-mono text-sm font-semibold">{span.op || "span"}</h4>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {span.status && <Field k={t("status")} v={span.status} />}
        <Field k={t("spanStart")} v={formatDuration(span.start_ms, locale)} />
        <Field k={t("duration")} v={formatDuration(span.duration_ms, locale)} />
        {spanDesc(span) && <Field k={t("description")} v={spanDesc(span)} wide />}
        <Field k="span_id" v={span.span_id} mono />
        {span.parent_span_id && <Field k="parent_span_id" v={span.parent_span_id} mono />}
      </dl>
      {entries.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-[var(--radius-sm)] border border-border">
          <table className="w-full text-xs" dir="ltr">
            <tbody className="divide-y divide-border">
              {entries.map(([k, v]) => (
                <tr key={k}>
                  <td className="whitespace-nowrap bg-muted/40 px-3 py-1.5 font-mono font-medium">
                    {k}
                  </td>
                  <td className="break-all px-3 py-1.5 font-mono text-muted-foreground">
                    {typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({ k, v, mono, wide }: { k: string; v: string; mono?: boolean; wide?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 py-0.5 text-sm",
        wide && "sm:col-span-2"
      )}
    >
      <dt className="shrink-0 text-muted-foreground">{k}</dt>
      <dd
        className={cn("min-w-0 truncate text-end", mono && "font-mono text-xs")}
        dir={mono ? "ltr" : undefined}
        title={v}
      >
        {v}
      </dd>
    </div>
  );
}

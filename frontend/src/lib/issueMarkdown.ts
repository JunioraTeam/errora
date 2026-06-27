/**
 * Render an issue (+ its latest event) as a compact Markdown summary tuned for
 * pasting into an LLM: just the signal needed to reason about the bug —
 * identity, exception + stack, recent breadcrumbs, request, and key tags. No
 * UI chrome, packages list, or 100-frame dumps.
 */

import type { Breadcrumb, EventData, ExceptionValue, IssueDetail, StackFrame } from "./types";

const MAX_FRAMES = 20;
const MAX_BREADCRUMBS = 12;
const TAG_ALLOWLIST = [
  "browser",
  "os",
  "runtime",
  "url",
  "transaction",
  "server_name",
  "handled",
  "mechanism",
];

function frameLine(f: StackFrame): string {
  const loc = `${f.filename || f.abs_path || "?"}${f.lineno != null ? `:${f.lineno}` : ""}`;
  return f.function ? `${loc} in ${f.function}` : loc;
}

function stackBlock(ex: ExceptionValue): string {
  const frames = ex.stacktrace?.frames ?? [];
  // Sentry orders oldest→newest; show the crash first, prefer in-app frames.
  const ordered = [...frames].reverse();
  const inApp = ordered.filter((f) => f.in_app);
  const chosen = (inApp.length ? inApp : ordered).slice(0, MAX_FRAMES);
  const lines: string[] = [];
  for (const f of chosen) {
    lines.push(frameLine(f));
    if (f.context_line) lines.push(`    ${f.context_line.trim()}`);
  }
  return lines.join("\n");
}

function breadcrumbLine(b: Breadcrumb): string {
  const cat = b.category || b.type || "default";
  const took =
    typeof b.data?.executionTimeMs === "number"
      ? ` (${(b.data.executionTimeMs as number).toFixed(2)}ms)`
      : "";
  let msg = b.message ?? "";
  // HTTP-client breadcrumbs (e.g. Laravel) often carry the request in `data`.
  if (!msg && cat.toLowerCase().includes("http")) {
    const d = (b.data ?? {}) as Record<string, unknown>;
    const method = d.method ?? d["http.request.method"];
    const url = d.url ?? d["http.url"];
    const status = d.status_code ?? d["http.response.status_code"];
    msg = [method, url, status != null ? `→ ${status}` : ""].filter(Boolean).join(" ");
  }
  return `- [${cat}] ${msg}${took}`.trimEnd();
}

function tagPairs(tags: EventData["tags"]): Array<[string, string]> {
  if (!tags) return [];
  return Array.isArray(tags) ? tags : Object.entries(tags);
}

export function issueToMarkdown(issue: IssueDetail): string {
  const data = issue.latest_event?.data;
  const exceptions = data?.exception?.values ?? [];
  const mech = exceptions.at(-1)?.mechanism;
  const handledNote =
    mech?.handled === false ? " (unhandled)" : mech?.handled === true ? " (handled)" : "";

  const out: string[] = [`# ${issue.title || issue.type || "Error"}`, ""];

  const meta: Array<[string, string | undefined]> = [
    ["Level", issue.level],
    ["Status", issue.status],
    ["Priority", issue.priority],
    ["Culprit", issue.culprit ? `\`${issue.culprit}\`` : undefined],
    ["Transaction", data?.transaction],
    ["Environment", data?.environment],
    ["Release", data?.release],
    ["Platform", data?.platform],
    ["Mechanism", mech?.type ? `${mech.type}${handledNote}` : undefined],
    ["Times seen", String(issue.times_seen)],
    ["First seen", issue.first_seen],
    ["Last seen", issue.last_seen],
    ["Event ID", data?.event_id],
  ];
  for (const [k, v] of meta) {
    if (v) out.push(`- **${k}:** ${v}`);
  }

  const req = data?.request;
  if (req?.url || req?.method) {
    out.push("", "## HTTP request", `${req.method || "GET"} ${req.url || ""}`.trim());
  }

  if (exceptions.length) {
    out.push("", "## Exception");
    for (const ex of exceptions) {
      out.push("", `**${ex.type}**${ex.value ? `: ${ex.value}` : ""}`);
      const block = stackBlock(ex);
      if (block) out.push("", "```", block, "```");
    }
  }

  const crumbs = data?.breadcrumbs ?? [];
  if (crumbs.length) {
    out.push("", "## Breadcrumbs (most recent last)");
    for (const b of crumbs.slice(-MAX_BREADCRUMBS)) out.push(breadcrumbLine(b));
  }

  const selectedTags = tagPairs(data?.tags).filter(([k]) => TAG_ALLOWLIST.includes(k));
  if (selectedTags.length) {
    out.push("", "## Tags");
    for (const [k, v] of selectedTags) out.push(`- ${k}: ${v}`);
  }

  return `${out.join("\n").trim()}\n`;
}

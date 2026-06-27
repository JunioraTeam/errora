import type { IssueRepository, StackFrame } from "./types";

/** Return the URL only if it's a safe http(s) link, else null. Guards against
 * `javascript:`/`data:` hrefs sneaking in from server-stored integration data
 * (web_url, mr_url) and becoming clickable XSS on `target="_blank"` anchors. */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** Build a "blame"/source link to a specific frame in the linked repository.
 * GitLab uses `/-/blame/<branch>/<path>`; GitHub uses `/blame/<branch>/<path>`. */
export function blameUrl(repo: IssueRepository, frame: StackFrame): string | null {
  const base = safeExternalUrl(repo.web_url);
  const path = (frame.filename || frame.abs_path || "").replace(/^\/+/, "");
  if (!path || !base) return null;
  const line = frame.lineno ? `#L${frame.lineno}` : "";
  const seg = repo.provider === "github" ? "blame" : "-/blame";
  return `${base.replace(/\/$/, "")}/${seg}/${repo.default_branch}/${path}${line}`;
}

/** Human label for the provider behind a repository link. */
export function providerLabel(provider?: string): string {
  if (provider === "github") return "GitHub";
  if (provider === "gitlab") return "GitLab";
  return "repository";
}

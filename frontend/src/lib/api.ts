import { tokenStore } from "./token-store";
import type {
  AIConfig,
  AIProviderType,
  AlertEventType,
  AlertRule,
  ApiToken,
  AuthResponse,
  AutoFixRun,
  BulkAction,
  ChannelType,
  Integration,
  Invite,
  Issue,
  IssueComment,
  IssueDetail,
  IssueEvent,
  IssueExternalIssue,
  IssueLevel,
  IssuePriority,
  IssueSeries,
  IssueStatus,
  IssueTrends,
  LogEntry,
  LogListResponse,
  Membership,
  NotificationChannel,
  NotificationLog,
  Organization,
  OrgRole,
  Paginated,
  Project,
  ProjectStats,
  Repository,
  TrackerIssue,
  Tokens,
  TransactionDetail,
  TransactionGroupDetail,
  TransactionListResponse,
  Usage,
  User,
} from "./types";

// Resolve the API origin. Priority:
//   1) NEXT_PUBLIC_API_URL  — baked at build time (use when the API lives on a
//      different origin than the frontend).
//   2) window.location.origin — runtime fallback for the merged single-origin
//      deployment, where the frontend and API share a domain behind one proxy.
//   3) http://localhost:8000 — dev default (also the SSR value; every consumer
//      of this module is a client component, so no request runs server-side).
function resolveApiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  if (env) return env;
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:8000";
}

const API_BASE = resolveApiBase();
const API_PREFIX = `${API_BASE}/api/v1`;

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
  /** Internal guard so a refresh attempt does not recurse forever. */
  _retried?: boolean;
};

// Track an in-flight refresh so concurrent 401s share one refresh call.
let refreshPromise: Promise<Tokens> | null = null;

async function doRefresh(): Promise<Tokens> {
  const current = tokenStore.get();
  if (!current) throw new ApiError(401, "Not authenticated");

  if (!refreshPromise) {
    refreshPromise = (async () => {
      const res = await fetch(`${API_PREFIX}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: current.refresh }),
      });
      if (!res.ok) {
        tokenStore.clear();
        throw new ApiError(res.status, "Session expired");
      }
      const data = (await res.json()) as { tokens: Tokens };
      tokenStore.set(data.tokens);
      return data.tokens;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true, signal, _retried } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";

  if (auth) {
    const tokens = tokenStore.get();
    if (tokens) headers["Authorization"] = `Bearer ${tokens.access}`;
  }

  const res = await fetch(`${API_PREFIX}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  // Auto-refresh on 401 once.
  if (res.status === 401 && auth && !_retried) {
    try {
      await doRefresh();
      return request<T>(path, { ...options, _retried: true });
    } catch {
      tokenStore.clear();
      throw new ApiError(401, "Unauthorized");
    }
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const message =
      (data && typeof data === "object" && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : res.statusText) || "Request failed";
    throw new ApiError(res.status, message, data);
  }

  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Extract DRF field-validation errors from a thrown ApiError. DRF returns
 * ``{field: ["msg", …]}`` (plus optional ``detail`` / ``non_field_errors`` for
 * form-level errors). Returns a flat ``{field: "joined message"}`` map; the
 * special key ``__all__`` holds any non-field/form-level error.
 */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !err.body || typeof err.body !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(err.body as Record<string, unknown>)) {
    const msg = Array.isArray(val) ? val.map(String).join(" ") : String(val);
    out[key === "detail" || key === "non_field_errors" ? "__all__" : key] = msg;
  }
  return out;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

// ------------------------------------------------------------------ //
// Typed endpoints                                                     //
// ------------------------------------------------------------------ //

export const api = {
  baseUrl: API_BASE,

  auth: {
    /** Merged login-or-register: existing identifier logs in, new one signs up. */
    access(body: { identifier: string; password: string; totp?: string }) {
      return request<AuthResponse>("/auth/access", {
        method: "POST",
        body,
        auth: false,
      });
    },
    register(body: { identifier: string; password: string }) {
      return request<AuthResponse>("/auth/register", {
        method: "POST",
        body,
        auth: false,
      });
    },
    login(body: { identifier: string; password: string; totp?: string }) {
      return request<AuthResponse>("/auth/login", {
        method: "POST",
        body,
        auth: false,
      });
    },
    requestOtp(body: { identifier: string }) {
      return request<{ detail: string }>("/auth/otp/request", {
        method: "POST",
        body,
        auth: false,
      });
    },
    verifyOtp(body: { identifier: string; code: string }) {
      return request<AuthResponse>("/auth/otp/verify", {
        method: "POST",
        body,
        auth: false,
      });
    },
    refresh(refresh: string) {
      return request<{ tokens: Tokens }>("/auth/refresh", {
        method: "POST",
        body: { refresh },
        auth: false,
      });
    },
    logout() {
      // Server-side revoke (bumps the user's token version → all tokens die).
      return request<{ detail: string }>("/auth/logout", { method: "POST" });
    },
    me() {
      return request<User>("/auth/me");
    },
    updateProfile(body: {
      first_name?: string;
      last_name?: string;
      name?: string;
      email?: string | null;
    }) {
      return request<User>("/auth/me", { method: "PATCH", body });
    },
    changePassword(body: { current_password?: string; new_password: string }) {
      return request<{ detail: string; tokens: Tokens }>("/auth/password", {
        method: "POST",
        body,
      });
    },
    totpSetup() {
      return request<{ secret: string; otpauth_uri: string }>("/auth/totp/setup", {
        method: "POST",
      });
    },
    totpEnable(code: string) {
      return request<User>("/auth/totp/enable", {
        method: "POST",
        body: { code },
      });
    },
    totpDisable(body: { code?: string; password?: string }) {
      return request<User>("/auth/totp/disable", { method: "POST", body });
    },
  },

  tokens: {
    list() {
      return request<{ results: ApiToken[] }>("/auth/tokens");
    },
    create(body: { name: string; expires_in_days?: number }) {
      return request<ApiToken>("/auth/tokens", { method: "POST", body });
    },
    remove(id: string) {
      return request<void>(`/auth/tokens/${id}`, { method: "DELETE" });
    },
  },

  orgs: {
    list() {
      return request<Organization[] | Paginated<Organization>>("/organizations");
    },
    create(name: string) {
      return request<Organization>("/organizations", {
        method: "POST",
        body: { name },
      });
    },
    update(orgId: string, body: { name?: string; retention_days?: number | null }) {
      return request<Organization>(`/organizations/${orgId}`, {
        method: "PATCH",
        body,
      });
    },
    usage(orgId: string) {
      return request<Usage>(`/organizations/${orgId}/usage`);
    },
    members(orgId: string) {
      return request<Membership[]>(`/organizations/${orgId}/members`);
    },
    updateMember(orgId: string, memberId: string, role: OrgRole) {
      return request<Membership>(`/organizations/${orgId}/members/${memberId}`, {
        method: "PATCH",
        body: { role },
      });
    },
    invite(orgId: string, body: { email: string; role: OrgRole }) {
      return request<Invite>(`/organizations/${orgId}/invite`, {
        method: "POST",
        body,
      });
    },
  },

  integrations: {
    list(orgId: string) {
      return request<Integration[] | Paginated<Integration>>(
        `/organizations/${orgId}/integrations`
      );
    },
    create(
      orgId: string,
      body: { provider: string; name?: string; base_url: string; access_token: string }
    ) {
      return request<Integration>(`/organizations/${orgId}/integrations`, {
        method: "POST",
        body,
      });
    },
    remove(orgId: string, id: string) {
      return request<void>(`/organizations/${orgId}/integrations/${id}`, {
        method: "DELETE",
      });
    },
    sync(orgId: string, id: string) {
      return request<Repository[]>(`/organizations/${orgId}/integrations/${id}/sync`, {
        method: "POST",
      });
    },
    repositories(orgId: string, id: string) {
      return request<Repository[]>(`/organizations/${orgId}/integrations/${id}/repositories`);
    },
  },

  channels: {
    list(orgId: string) {
      return request<NotificationChannel[] | Paginated<NotificationChannel>>(
        `/organizations/${orgId}/channels`
      );
    },
    create(
      orgId: string,
      body: {
        name: string;
        type: ChannelType;
        config: Record<string, unknown>;
        secret?: string;
      }
    ) {
      return request<NotificationChannel>(`/organizations/${orgId}/channels`, {
        method: "POST",
        body,
      });
    },
    remove(orgId: string, id: string) {
      return request<void>(`/organizations/${orgId}/channels/${id}`, {
        method: "DELETE",
      });
    },
  },

  alertRules: {
    list(orgId: string) {
      return request<AlertRule[] | Paginated<AlertRule>>(`/organizations/${orgId}/alert-rules`);
    },
    create(
      orgId: string,
      body: { event_type: AlertEventType; channel: string; project?: string | null }
    ) {
      return request<AlertRule>(`/organizations/${orgId}/alert-rules`, {
        method: "POST",
        body,
      });
    },
    update(orgId: string, id: string, body: { enabled: boolean }) {
      return request<AlertRule>(`/organizations/${orgId}/alert-rules/${id}`, {
        method: "PATCH",
        body,
      });
    },
    remove(orgId: string, id: string) {
      return request<void>(`/organizations/${orgId}/alert-rules/${id}`, {
        method: "DELETE",
      });
    },
  },

  notificationLogs: {
    list(
      orgId: string,
      params: {
        success?: string;
        channel_type?: string;
        event_type?: string;
        limit?: number;
        offset?: number;
      } = {}
    ) {
      return request<NotificationLog[] | Paginated<NotificationLog>>(
        `/organizations/${orgId}/notification-logs${qs(params)}`
      );
    },
    replay(orgId: string, id: string) {
      return request<{ detail: string }>(`/organizations/${orgId}/notification-logs/${id}/replay`, {
        method: "POST",
      });
    },
  },

  aiConfigs: {
    list(orgId: string) {
      return request<AIConfig[] | Paginated<AIConfig>>(`/organizations/${orgId}/ai-configs`);
    },
    create(
      orgId: string,
      body: {
        name?: string;
        provider: AIProviderType;
        model: string;
        base_url?: string;
        api_key?: string;
        auto_trigger?: boolean;
        enabled?: boolean;
      }
    ) {
      return request<AIConfig>(`/organizations/${orgId}/ai-configs`, {
        method: "POST",
        body,
      });
    },
    update(
      orgId: string,
      id: string,
      body: Partial<{
        name: string;
        provider: AIProviderType;
        model: string;
        base_url: string;
        api_key: string;
        auto_trigger: boolean;
        enabled: boolean;
      }>
    ) {
      return request<AIConfig>(`/organizations/${orgId}/ai-configs/${id}`, {
        method: "PATCH",
        body,
      });
    },
    remove(orgId: string, id: string) {
      return request<void>(`/organizations/${orgId}/ai-configs/${id}`, {
        method: "DELETE",
      });
    },
  },

  autofixRuns: {
    list(
      orgId: string,
      params: {
        status?: string;
        project?: string;
        limit?: number;
        offset?: number;
      } = {}
    ) {
      return request<Paginated<AutoFixRun>>(`/organizations/${orgId}/autofix-runs${qs(params)}`);
    },
  },

  performance: {
    list(
      projectId: string,
      params: {
        q?: string;
        stats_period?: string;
        sort?: string;
        order?: "asc" | "desc";
        limit?: number;
        offset?: number;
      } = {}
    ) {
      return request<TransactionListResponse>(`/projects/${projectId}/transactions${qs(params)}`);
    },
    get(projectId: string, id: string, params: { stats_period?: string } = {}) {
      return request<TransactionGroupDetail>(
        `/projects/${projectId}/transactions/${id}${qs(params)}`
      );
    },
    transaction(projectId: string, eventId: string) {
      return request<TransactionDetail>(`/projects/${projectId}/transaction-events/${eventId}`);
    },
  },

  logs: {
    list(
      projectId: string,
      params: {
        q?: string;
        level?: string;
        environment?: string;
        stats_period?: string;
        limit?: number;
        offset?: number;
      } = {}
    ) {
      return request<LogListResponse>(`/projects/${projectId}/logs${qs(params)}`);
    },
    get(projectId: string, id: string) {
      return request<LogEntry>(`/projects/${projectId}/logs/${id}`);
    },
    attributeKeys(projectId: string, params: { stats_period?: string } = {}) {
      return request<{ keys: string[] }>(`/projects/${projectId}/logs/attribute-keys${qs(params)}`);
    },
  },

  projects: {
    list(orgId: string) {
      return request<Project[] | Paginated<Project>>(`/organizations/${orgId}/projects`);
    },
    create(orgId: string, body: { name: string; platform: string }) {
      return request<Project>(`/organizations/${orgId}/projects`, {
        method: "POST",
        body,
      });
    },
    stats(orgId: string, days = 7) {
      return request<ProjectStats>(`/organizations/${orgId}/projects/stats${qs({ days })}`);
    },
  },

  issues: {
    list(
      projectId: string,
      params: {
        status?: IssueStatus | "";
        level?: IssueLevel | "";
        q?: string;
        environment?: string;
        date_from?: string;
        date_to?: string;
        limit?: number;
        offset?: number;
      } = {}
    ) {
      return request<Paginated<Issue>>(`/projects/${projectId}/issues${qs(params)}`);
    },
    get(projectId: string, id: string) {
      return request<IssueDetail>(`/projects/${projectId}/issues/${id}`);
    },
    resolve(projectId: string, id: string) {
      return request<Issue>(`/projects/${projectId}/issues/${id}/resolve`, {
        method: "POST",
      });
    },
    unresolve(projectId: string, id: string) {
      return request<Issue>(`/projects/${projectId}/issues/${id}/unresolve`, {
        method: "POST",
      });
    },
    ignore(projectId: string, id: string) {
      return request<Issue>(`/projects/${projectId}/issues/${id}/ignore`, {
        method: "POST",
      });
    },
    archive(projectId: string, id: string) {
      return request<Issue>(`/projects/${projectId}/issues/${id}/archive`, {
        method: "POST",
      });
    },
    bookmark(projectId: string, id: string, bookmarked?: boolean) {
      return request<Issue>(`/projects/${projectId}/issues/${id}/bookmark`, {
        method: "POST",
        body: bookmarked === undefined ? {} : { bookmarked },
      });
    },
    assign(projectId: string, id: string, assignees: string[]) {
      return request<Issue>(`/projects/${projectId}/issues/${id}/assign`, {
        method: "POST",
        body: { assignees },
      });
    },
    setPriority(projectId: string, id: string, priority: IssuePriority) {
      return request<Issue>(`/projects/${projectId}/issues/${id}/priority`, {
        method: "POST",
        body: { priority },
      });
    },
    bulk(
      projectId: string,
      body: { ids: string[]; action: BulkAction; value?: IssuePriority | string[] }
    ) {
      return request<{ updated: number }>(`/projects/${projectId}/issues/bulk`, {
        method: "POST",
        body,
      });
    },
    trends(projectId: string, ids: string[], opts: { days?: number; period?: "24h" | "30d" } = {}) {
      const params: Record<string, string | number> = { ids: ids.join(",") };
      if (opts.period) params.period = opts.period;
      else params.days = opts.days ?? 14;
      return request<IssueTrends>(`/projects/${projectId}/issues/trends${qs(params)}`);
    },
    series(projectId: string, id: string, period: "24h" | "30d") {
      return request<IssueSeries>(
        `/projects/${projectId}/issues/${id}/series${qs({ period })}`
      );
    },
    repositories(projectId: string, id: string) {
      return request<Repository[]>(`/projects/${projectId}/issues/${id}/repositories`);
    },
    externalIssues(projectId: string, id: string) {
      return request<IssueExternalIssue[]>(
        `/projects/${projectId}/issues/${id}/external-issues`
      );
    },
    searchExternalIssues(projectId: string, id: string, repository: string, q: string) {
      return request<{ results: TrackerIssue[] }>(
        `/projects/${projectId}/issues/${id}/external-issues/search${qs({ repository, q })}`
      );
    },
    createExternalIssue(
      projectId: string,
      id: string,
      body: { repository: string; title: string; description: string }
    ) {
      return request<IssueExternalIssue>(`/projects/${projectId}/issues/${id}/external-issues`, {
        method: "POST",
        body,
      });
    },
    linkExternalIssue(
      projectId: string,
      id: string,
      body: { repository: string; external_id: string; comment?: string }
    ) {
      return request<IssueExternalIssue>(`/projects/${projectId}/issues/${id}/external-issues`, {
        method: "POST",
        body: { ...body, mode: "link" },
      });
    },
    merge(projectId: string, id: string, sources: string[]) {
      return request<Issue>(`/projects/${projectId}/issues/${id}/merge`, {
        method: "POST",
        body: { sources },
      });
    },
    autofix(projectId: string, id: string) {
      return request<AutoFixRun>(`/projects/${projectId}/issues/${id}/autofix`, {
        method: "POST",
      });
    },
    autofixRuns(projectId: string, id: string) {
      return request<AutoFixRun[]>(`/projects/${projectId}/issues/${id}/autofix`);
    },
    autofixStreamTicket(projectId: string, id: string, runId: string) {
      return request<{ token: string }>(
        `/projects/${projectId}/issues/${id}/autofix/stream-ticket`,
        { method: "POST", body: { run_id: runId } }
      );
    },
    events(projectId: string, id: string, params: { limit?: number; offset?: number } = {}) {
      return request<Paginated<IssueEvent>>(
        `/projects/${projectId}/issues/${id}/events${qs(params)}`
      );
    },
    event(projectId: string, eventId: string) {
      return request<IssueEvent>(`/projects/${projectId}/events/${eventId}`);
    },
    comments(projectId: string, id: string) {
      return request<IssueComment[] | Paginated<IssueComment>>(
        `/projects/${projectId}/issues/${id}/comments`
      );
    },
    addComment(projectId: string, id: string, body: string) {
      return request<IssueComment>(`/projects/${projectId}/issues/${id}/comments`, {
        method: "POST",
        body: { body },
      });
    },
  },
};

/** Normalize an endpoint that may return either a bare array or DRF pagination. */
export function unwrapList<T>(data: T[] | Paginated<T>): T[] {
  return Array.isArray(data) ? data : data.results;
}

export { API_BASE, API_PREFIX };

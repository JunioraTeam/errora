// Shared API domain types for the Errora platform.

export type Tokens = {
  access: string;
  refresh: string;
};

export type User = {
  id: string;
  name: string;
  first_name?: string;
  last_name?: string;
  display_name?: string;
  email?: string | null;
  email_verified?: boolean;
  totp_enabled?: boolean;
  has_password?: boolean;
  avatar_url?: string | null;
};

export type AuthResponse = {
  user: User;
  tokens: Tokens;
};

export type Organization = {
  id: string;
  name: string;
  slug?: string;
  role?: OrgRole;
  /** Org-level data retention override (days); `null` = inherit the default. */
  retention_days?: number | null;
  /** Retention applied when no override is set (plan or global default). */
  default_retention_days?: number;
};

export type OrgRole = "owner" | "admin" | "member" | "viewer";

/** Personal access token (bearer credential for the MCP server / API). */
export type ApiToken = {
  id: string;
  name: string;
  token_prefix: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  /** Present only in the create response — shown to the user once. */
  token?: string;
};

export type Member = {
  id: string;
  user: User;
  role: OrgRole;
};

export type ProjectKey = {
  id: string;
  dsn: string;
  public_key?: string;
};

export type Project = {
  id: string;
  name: string;
  slug?: string;
  platform: string;
  keys: ProjectKey[];
  open_issues_count?: number;
  last_event_at?: string | null;
};

export type IssueLevel = "fatal" | "error" | "warning" | "info" | "debug";
export type IssueStatus = "unresolved" | "resolved" | "ignored" | "archived";
export type IssuePriority = "low" | "medium" | "high";
export type AutofixState = "idle" | "pending" | "running" | "completed" | "failed";

export type Issue = {
  id: string;
  title: string;
  type: string;
  value: string;
  culprit: string;
  level: IssueLevel;
  status: IssueStatus;
  priority: IssuePriority;
  times_seen: number;
  first_seen: string;
  last_seen: string;
  assignees: string[];
  autofix_state: AutofixState;
  project_name?: string;
  /** Whether the current user has opened this issue at least once. */
  has_seen?: boolean;
  /** Unique affected users (distinct user identities across events). */
  users_seen?: number;
  /** Whether the current user has bookmarked (starred) this issue. */
  is_bookmarked?: boolean;
};

/** A linked tracker issue in a connected provider (e.g. a GitLab issue). */
export type IssueExternalIssue = {
  id: string;
  repository: string;
  repository_name: string;
  provider: string;
  external_id: string;
  title: string;
  web_url: string;
  created_at: string;
};

/** A tracker issue returned from a provider search (not yet linked). */
export type TrackerIssue = {
  iid: string;
  title: string;
  web_url: string;
  state?: string;
};

/** Bucketed event counts for a single issue's trend chart. */
export type IssueSeries = {
  period: "24h" | "30d";
  buckets: Array<{ ts: string; count: number }>;
};

/** Per-project daily errors + transactions for the project-card trend bars. */
export type ProjectStats = Record<string, { errors: number[]; transactions: number[] }>;

/** Per-issue daily event counts (oldest→newest) for sparklines, keyed by issue id. */
export type IssueTrends = Record<string, number[]>;

export type BulkAction = "resolve" | "ignore" | "unresolve" | "priority" | "assign";

export type StackFrame = {
  filename: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  abs_path?: string;
  /** Resolved from a source map at ingest (original file/line/column shown). */
  symbolicated?: boolean;
};

export type Mechanism = { type?: string; handled?: boolean | null };

export type ExceptionValue = {
  type: string;
  value: string;
  mechanism?: Mechanism;
  stacktrace?: {
    frames: StackFrame[];
  };
};

export type Breadcrumb = {
  timestamp?: number;
  type?: string;
  category?: string;
  level?: string;
  message?: string;
  data?: Record<string, unknown>;
};

export type ContextValue = {
  name?: string;
  version?: string;
  type?: string;
} & Record<string, unknown>;

export type TraceContext = {
  trace_id?: string;
  span_id?: string;
  op?: string;
  status?: string;
} & Record<string, unknown>;

export type EventContexts = {
  browser?: ContextValue;
  os?: ContextValue;
  runtime?: ContextValue;
  device?: ContextValue;
  trace?: TraceContext;
} & Record<string, ContextValue | TraceContext | undefined>;

export type SdkInfo = {
  name?: string;
  version?: string;
  packages?: Array<{ name: string; version: string }>;
};

export type GroupingInfo = { hash?: string; config?: string; components?: string[] };

export type EventData = {
  exception?: {
    values: ExceptionValue[];
  };
  tags?: Record<string, string> | Array<[string, string]>;
  request?: {
    method?: string;
    url?: string;
    headers?: Array<[string, string]> | Record<string, string>;
    data?: unknown;
  };
  user?: {
    id?: string;
    email?: string;
    ip_address?: string;
    username?: string;
  };
  contexts?: EventContexts;
  breadcrumbs?: Breadcrumb[];
  modules?: Record<string, string>;
  sdk?: SdkInfo;
  environment?: string;
  release?: string;
  dist?: string;
  server_name?: string;
  transaction?: string;
  event_id?: string;
  platform?: string;
  level?: string;
  _grouping?: GroupingInfo;
};

export type IssueRepository = {
  provider: string;
  web_url: string;
  default_branch: string;
  path_with_namespace: string;
};

export type IssueEvent = {
  /** Legacy alias; the API primary key is `event_id`. */
  id?: string;
  event_id?: string;
  timestamp?: string;
  received_at?: string;
  level?: IssueLevel;
  environment?: string;
  release?: string;
  message?: string;
  data: EventData;
};

export type IssueComment = {
  id: string;
  body: string;
  author: string | null;
  author_name: string;
  created_at: string;
};

export type IssueDetail = Issue & {
  latest_event: IssueEvent | null;
  repository?: IssueRepository | null;
};

export type Paginated<T> = {
  count: number;
  next?: string | null;
  previous?: string | null;
  results: T[];
};

// --- Performance / tracing ----------------------------------------------- //

export type TransactionMetrics = {
  /** Number of transactions in the selected window. */
  count: number;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  p99: number | null;
  avg: number | null;
  /** Fraction (0–1) of transactions whose trace status is a failure. */
  failure_rate: number;
  /** Throughput: transactions per minute over the window. */
  tpm: number;
};

export type TransactionGroup = {
  id: string;
  name: string;
  op: string;
  times_seen: number;
  first_seen: string;
  last_seen: string;
} & TransactionMetrics;

export type Span = {
  span_id: string;
  parent_span_id: string;
  op: string;
  description: string;
  status: string;
  /** Offset (ms) from the transaction start. */
  start_ms: number;
  duration_ms: number;
  /** Structured span data: db.system/db.statement, http method+status, cache hit/key, … */
  data?: Record<string, unknown>;
};

export type TransactionSample = {
  event_id: string;
  duration_ms: number;
  status: string;
  timestamp: string;
  trace_id: string;
  is_failed: boolean;
};

export type SpanOpBreakdown = { op: string; count: number; total_ms: number; avg_ms: number };
export type HistogramBin = { start: number; end: number; count: number };

export type TransactionGroupDetail = TransactionGroup & {
  breakdown: SpanOpBreakdown[];
  histogram: HistogramBin[];
  samples: TransactionSample[];
  stats_period: string;
};

export type TraceIssue = {
  id: string;
  title: string;
  type: string;
  value: string;
  level: IssueLevel;
  status: IssueStatus;
  culprit: string;
};

export type TransactionDetail = {
  event_id: string;
  name: string;
  op: string;
  status: string;
  trace_id: string;
  span_id: string;
  duration_ms: number;
  timestamp: string;
  environment: string;
  release: string;
  platform: string;
  is_failed: boolean;
  spans: Span[];
  /** Total spans recorded (≥ spans.length when the waterfall is truncated). */
  span_count: number;
  spans_truncated: boolean;
  /** Error issues sharing this trace. */
  issues: TraceIssue[];
};

export type TransactionListResponse = {
  count: number;
  results: TransactionGroup[];
  stats_period: string;
};

// --- Logs ----------------------------------------------------------------- //

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export const LOG_LEVELS: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];

export type LogEntry = {
  id: string;
  timestamp: string;
  level: LogLevel | "";
  severity_number: number;
  body: string;
  trace_id: string;
  span_id: string;
  environment: string;
  release: string;
  /** Flat bag of typed attributes (the log's tags). */
  attributes: Record<string, unknown>;
};

export type LogListResponse = {
  results: LogEntry[];
  count: number;
  /** Per-level counts for the current query (excluding the level filter). */
  facets: { level: Record<LogLevel, number> };
  stats_period: string;
};

// --- Settings: members, integrations, channels, alert rules, AI config --- //

export type Membership = {
  id: string;
  user: string; // user id
  user_email: string | null;
  user_name: string;
  role: OrgRole;
  created_at: string;
};

export type Invite = {
  id: string;
  email: string;
  role: OrgRole;
  status: "pending" | "accepted" | "expired";
  expires_at: string;
  created_at: string;
};

/** Public (pre-login) view of an invite, fetched by its token. */
export type InvitePreview = {
  email: string;
  role: OrgRole;
  organization_name: string;
  status: "pending" | "accepted" | "expired";
  valid: boolean;
  expired: boolean;
};

export type IntegrationProvider = "gitlab" | "github";

export type Integration = {
  id: string;
  provider: IntegrationProvider;
  name: string;
  base_url: string;
  is_active: boolean;
  connected: boolean;
  created_at: string;
};

export type Repository = {
  id: string;
  external_id: string;
  name: string;
  path_with_namespace: string;
  web_url: string;
  default_branch: string;
};

export type ChannelType = "webhook" | "mattermost" | "email" | "sms";

export type NotificationChannel = {
  id: string;
  name: string;
  type: ChannelType;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
};

export type AlertEventType =
  | "issue.created"
  | "event.received"
  | "issue.regressed"
  | "autofix.started"
  | "autofix.mr_created"
  | "autofix.failed";

export type AlertRule = {
  id: string;
  project: string | null;
  event_type: AlertEventType;
  channel: string; // channel id
  enabled: boolean;
  created_at: string;
};

export type NotificationLog = {
  id: string;
  rule: string | null;
  channel_type: ChannelType;
  event_type: AlertEventType;
  success: boolean;
  detail: string;
  message: Record<string, unknown>;
  created_at: string;
};

export type AIProviderType = "openai" | "claude" | "cursor";

export type AIConfig = {
  id: string;
  organization: string;
  project: string | null;
  name: string;
  provider: AIProviderType;
  base_url: string;
  has_key: boolean;
  model: string;
  auto_trigger: boolean;
  enabled: boolean;
  created_at: string;
};

export type Usage = {
  period_start: string;
  period_end: string;
  events_consumed: number;
  /** `null` means no quota is set → unlimited. */
  quota: number | null;
  overage_events: number;
  overage_cost_toman: number;
  by_day?: Array<{ date: string; events: number }>;
  by_month?: Array<{ period: string; events: number }>;
};

export type AutofixRunStatus =
  | "queued"
  | "analyzing"
  | "generating"
  | "creating_mr"
  | "completed"
  | "failed";

export type AutoFixRun = {
  id: string;
  issue: string;
  issue_title: string;
  project_id: string;
  project_name: string;
  provider: string;
  model: string;
  status: AutofixRunStatus;
  explanation: string;
  diff: string;
  mr_url: string;
  branch: string;
  error: string;
  tokens_used: number;
  triggered_by_name: string | null;
  created_at: string;
  updated_at: string;
};

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Github,
  Gitlab,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Trash2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { EmptyState, PageHeader } from "@/components/dashboard/PageHeader";
import { useOrg } from "@/components/providers/OrgProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { ApiError, api, unwrapList } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import type {
  AIConfig,
  AIProviderType,
  AlertEventType,
  AlertRule,
  ApiToken,
  ChannelType,
  Integration,
  Invite,
  Membership,
  NotificationChannel,
  NotificationLog,
  OrgRole,
  Repository,
} from "@/lib/types";
import { localizeDigits } from "@/lib/utils";

const ALL_ROLES: OrgRole[] = ["owner", "admin", "member", "viewer"];
const EVENT_TYPES: AlertEventType[] = [
  "issue.created",
  "event.received",
  "issue.regressed",
  "autofix.started",
  "autofix.mr_created",
  "autofix.failed",
];
const CHANNEL_TYPES: ChannelType[] = ["webhook", "mattermost", "email", "sms"];
const AI_PROVIDERS: AIProviderType[] = ["claude", "openai", "cursor"];

// Default HTTP webhook payload template, shown to the user as a starting point.
const DEFAULT_WEBHOOK_TEMPLATE = `{
  "event": "{{ event }}",
  "title": "{{ title }}",
  "body": "{{ body }}",
  "url": "{{ url }}",
  "level": "{{ level }}",
  "issue_id": "{{ issue_id }}"
}`;
const DEFAULT_TEXT_TEMPLATE = "{{ title }}\n{{ body }}\n{{ url }}";

const slug = (s: string) => s.replace(/\./g, "_");

function useApiError() {
  const [error, setError] = React.useState<string | null>(null);
  const handle = React.useCallback((e: unknown) => {
    setError(e instanceof ApiError ? e.message : "Request failed");
  }, []);
  return { error, setError, handle };
}

export default function SettingsPage() {
  const t = useTranslations("dashboard.settings");
  const [tab, setTab] = React.useState("organization");

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="space-y-5 p-5 sm:p-8">
        <Tabs
          value={tab}
          onValueChange={setTab}
          items={[
            { value: "organization", label: t("tabs.organization") },
            { value: "members", label: t("tabs.members") },
            { value: "integrations", label: t("tabs.integrations") },
            { value: "webhooks", label: t("tabs.webhooks") },
            { value: "ai", label: t("tabs.ai") },
            { value: "mcp", label: t("tabs.mcp") },
          ]}
        />
        {tab === "organization" && (
          <div className="space-y-5">
            <OrganizationTab />
            <RetentionCard />
          </div>
        )}
        {tab === "members" && <MembersTab />}
        {tab === "integrations" && <IntegrationsTab />}
        {tab === "webhooks" && <WebhooksTab />}
        {tab === "ai" && <AiTab />}
        {tab === "mcp" && <McpTab />}
      </div>
    </div>
  );
}

function TabError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-[var(--radius-sm)] bg-danger/10 px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

// --------------------------------------------------------------------- //
// Organization (rename)                                                 //
// --------------------------------------------------------------------- //
function OrganizationTab() {
  const t = useTranslations("dashboard.settings.organization");
  const tc = useTranslations("common");
  const { currentOrg, refetch } = useOrg();
  const { error, handle, setError } = useApiError();
  const [name, setName] = React.useState("");
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    setName(currentOrg?.name ?? "");
  }, [currentOrg]);

  // Only owners and admins may rename the organization.
  const canManage = currentOrg?.role === "owner" || currentOrg?.role === "admin";

  const save = useMutation({
    mutationFn: () => api.orgs.update(currentOrg!.id, { name: name.trim() }),
    onSuccess: () => {
      setSaved(true);
      refetch();
    },
    onError: handle,
  });

  if (!currentOrg) return null;

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="h-4 w-4 text-accent" />
        {t("title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("desc")}</p>
      <div className="mt-3">
        <TabError message={error} />
      </div>
      <form
        className="mt-3 max-w-md space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setSaved(false);
          if (name.trim()) save.mutate();
        }}
      >
        <Field label={t("name")} htmlFor="org-name">
          <Input
            id="org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canManage}
          />
        </Field>
        {canManage ? (
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              loading={save.isPending}
              disabled={!name.trim() || name.trim() === currentOrg.name}
            >
              {tc("save")}
            </Button>
            {saved && <span className="text-sm text-success">{t("saved")}</span>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noPermission")}</p>
        )}
      </form>
    </Card>
  );
}

function RetentionCard() {
  const t = useTranslations("dashboard.settings.retention");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { currentOrg, refetch } = useOrg();
  const { error, handle, setError } = useApiError();
  const [saved, setSaved] = React.useState(false);
  const [useDefault, setUseDefault] = React.useState(true);
  const [days, setDays] = React.useState("");

  React.useEffect(() => {
    if (!currentOrg) return;
    const v = currentOrg.retention_days;
    setUseDefault(v == null);
    setDays(v != null ? String(v) : "");
  }, [currentOrg]);

  const canManage = currentOrg?.role === "owner" || currentOrg?.role === "admin";
  const defaultDays = currentOrg?.default_retention_days ?? 90;
  const n = Number(days);
  const invalid = !useDefault && (!Number.isInteger(n) || n < 1 || n > 3650);

  const save = useMutation({
    mutationFn: () => api.orgs.update(currentOrg!.id, { retention_days: useDefault ? null : n }),
    onSuccess: () => {
      setSaved(true);
      refetch();
    },
    onError: handle,
  });

  if (!currentOrg) return null;

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <Archive className="h-4 w-4 text-accent" />
        {t("title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("desc")}</p>
      <div className="mt-3">
        <TabError message={error} />
      </div>
      <form
        className="mt-3 max-w-md space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setSaved(false);
          if (!invalid) save.mutate();
        }}
      >
        {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the custom Checkbox component (not a native input) */}
        <label className="flex items-center gap-2.5">
          <Checkbox
            checked={useDefault}
            disabled={!canManage}
            onCheckedChange={() => setUseDefault((v) => !v)}
          />
          <span className="text-sm">
            {t("useDefault", { days: localizeDigits(defaultDays, locale) })}
          </span>
        </label>

        {!useDefault && (
          <Field label={t("days")} htmlFor="retention-days">
            <Input
              id="retention-days"
              type="number"
              min={1}
              max={3650}
              dir="ltr"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              disabled={!canManage}
            />
          </Field>
        )}

        <p className="text-xs text-muted-foreground">{t("hint")}</p>

        {canManage ? (
          <div className="flex items-center gap-3">
            <Button type="submit" loading={save.isPending} disabled={invalid}>
              {tc("save")}
            </Button>
            {saved && <span className="text-sm text-success">{t("saved")}</span>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noPermission")}</p>
        )}
      </form>
    </Card>
  );
}

// --------------------------------------------------------------------- //
// MCP server + API tokens                                               //
// --------------------------------------------------------------------- //
function McpTab() {
  const t = useTranslations("dashboard.settings.mcp");
  const tc = useTranslations("common");
  const locale = useLocale();
  const qc = useQueryClient();
  const { error, handle, setError } = useApiError();
  const [name, setName] = React.useState("");
  const [created, setCreated] = React.useState<ApiToken | null>(null);
  const [copied, setCopied] = React.useState(false);

  const { data } = useQuery({ queryKey: ["api-tokens"], queryFn: () => api.tokens.list() });
  const tokens = data?.results ?? [];
  const mcpUrl = `${api.baseUrl}/mcp`;
  const configSnippet = JSON.stringify(
    { mcpServers: { errora: { url: mcpUrl, headers: { Authorization: "Bearer <token>" } } } },
    null,
    2
  );

  const create = useMutation({
    mutationFn: () => api.tokens.create({ name: name.trim() || "MCP token" }),
    onSuccess: (tok) => {
      setCreated(tok);
      setName("");
      qc.invalidateQueries({ queryKey: ["api-tokens"] });
    },
    onError: handle,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.tokens.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-tokens"] }),
    onError: handle,
  });

  async function copyToken() {
    if (!created?.token) return;
    await navigator.clipboard.writeText(created.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Terminal className="h-4 w-4 text-accent" />
          {t("connectTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("connectDesc")}</p>
        <div className="mt-3 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t("endpoint")}</p>
          <code
            dir="ltr"
            className="block truncate rounded-[var(--radius-sm)] bg-muted px-3 py-2 font-mono text-xs"
          >
            {mcpUrl}
          </code>
        </div>
        <div className="mt-3 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t("configExample")}</p>
          <CodeBlock
            code={configSnippet}
            lang="json"
            wrap={false}
            className="rounded-[var(--radius-sm)] bg-muted px-3 py-2 text-[11px]"
          />
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <KeyRound className="h-4 w-4 text-accent" />
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("desc")}</p>
        <div className="mt-3">
          <TabError message={error} />
        </div>

        {created?.token && (
          <div className="mt-3 rounded-[var(--radius-sm)] border border-success/40 bg-success/10 p-3">
            <p className="text-xs font-medium text-success">{t("createdOnce")}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <code dir="ltr" className="min-w-0 flex-1 truncate font-mono text-xs">
                {created.token}
              </code>
              <button
                type="button"
                onClick={copyToken}
                title={tc("copy")}
                className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
              >
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}

        <form
          className="mt-3 flex max-w-md flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setCreated(null);
            create.mutate();
          }}
        >
          <div className="flex-1">
            <Field label={t("tokenName")} htmlFor="token-name">
              <Input
                id="token-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("tokenNamePlaceholder")}
              />
            </Field>
          </div>
          <Button type="submit" loading={create.isPending}>
            <Plus className="h-4 w-4" />
            {t("create")}
          </Button>
        </form>

        {tokens.length > 0 && (
          <ul className="mt-4 divide-y divide-border rounded-[var(--radius-sm)] border border-border">
            {tokens.map((tok) => (
              <li key={tok.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{tok.name}</p>
                  <p className="truncate text-xs text-muted-foreground" dir="ltr">
                    {tok.token_prefix}…{" · "}
                    {tok.last_used_at
                      ? t("lastUsed", { when: formatDateTime(tok.last_used_at, locale) })
                      : t("neverUsed")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => remove.mutate(tok.id)}
                  title={tc("delete")}
                  aria-label={tc("delete")}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// --------------------------------------------------------------------- //
// Members & roles                                                       //
// --------------------------------------------------------------------- //
function MembersTab() {
  const t = useTranslations("dashboard.settings.members");
  const tr = useTranslations("dashboard.settings.members.roles");
  const tsts = useTranslations("dashboard.settings.members.statuses");
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const qc = useQueryClient();
  const { error, handle, setError } = useApiError();
  const [inviteOpen, setInviteOpen] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["members", orgId],
    queryFn: () => api.orgs.members(orgId as string),
    enabled: !!orgId,
  });
  const members: Membership[] = data ?? [];

  const { data: invitesData } = useQuery({
    queryKey: ["invites", orgId],
    queryFn: () => api.orgs.invites(orgId as string),
    enabled: !!orgId,
  });
  const invites: Invite[] = invitesData ?? [];

  const updateRole = useMutation({
    mutationFn: (v: { id: string; role: OrgRole }) =>
      api.orgs.updateMember(orgId as string, v.id, v.role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", orgId] }),
    onError: handle,
  });

  const resend = useMutation({
    mutationFn: (inv: Invite) =>
      api.orgs.invite(orgId as string, { email: inv.email, role: inv.role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invites", orgId] }),
    onError: handle,
  });

  if (!orgId || isLoading) return <Card className="p-6 text-muted-foreground">…</Card>;

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-4 w-4 text-accent" />
          {t("title")}
        </h2>
        <Button
          size="sm"
          onClick={() => {
            setError(null);
            setInviteOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          {t("invite")}
        </Button>
      </div>
      <div className="px-5 pt-3">
        <TabError message={error} />
      </div>
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH>{t("email")}</TH>
            <TH>{t("role")}</TH>
          </TR>
        </THead>
        <TBody>
          {members.map((m) => (
            <TR key={m.id}>
              <TD>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
                    {(m.user_name || m.user_email || "?").charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <div className="font-medium">{m.user_name || "—"}</div>
                    <div className="text-xs text-muted-foreground" dir="ltr">
                      {m.user_email}
                    </div>
                  </div>
                </div>
              </TD>
              <TD>
                <Select
                  value={m.role}
                  className="h-9 w-36"
                  disabled={updateRole.isPending}
                  onChange={(e) => updateRole.mutate({ id: m.id, role: e.target.value as OrgRole })}
                >
                  {ALL_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {tr(r)}
                    </option>
                  ))}
                </Select>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        orgId={orgId}
        onSent={() => qc.invalidateQueries({ queryKey: ["invites", orgId] })}
        onError={handle}
      />

      <div className="border-t border-border px-5 py-4">
        <h3 className="text-sm font-semibold text-muted-foreground">{t("pendingTitle")}</h3>
      </div>
      {invites.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground">{t("pendingEmpty")}</p>
      ) : (
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>{t("email")}</TH>
              <TH>{t("role")}</TH>
              <TH>{t("status")}</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {invites.map((inv) => (
              <TR key={inv.id}>
                <TD dir="ltr">{inv.email}</TD>
                <TD>{tr(inv.role)}</TD>
                <TD>
                  <Badge
                    variant={
                      inv.status === "accepted"
                        ? "success"
                        : inv.status === "expired"
                          ? "muted"
                          : "default"
                    }
                  >
                    {tsts(inv.status)}
                  </Badge>
                </TD>
                <TD className="text-end">
                  {inv.status !== "accepted" && (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={resend.isPending && resend.variables?.id === inv.id}
                      onClick={() => resend.mutate(inv)}
                    >
                      <RefreshCw className="h-4 w-4" />
                      {t("resend")}
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

function InviteDialog({
  open,
  onClose,
  orgId,
  onSent,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  onSent: () => void;
  onError: (e: unknown) => void;
}) {
  const t = useTranslations("dashboard.settings.members");
  const tr = useTranslations("dashboard.settings.members.roles");
  const tc = useTranslations("common");
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<OrgRole>("member");
  const [done, setDone] = React.useState(false);

  const invite = useMutation({
    mutationFn: () => api.orgs.invite(orgId, { email, role }),
    onSuccess: () => {
      setDone(true);
      setEmail("");
      onSent();
    },
    onError,
  });

  return (
    <Dialog open={open} onClose={onClose} title={t("invite")}>
      {done ? (
        <div className="space-y-4">
          <p className="text-sm text-success">{t("inviteSent")}</p>
          <Button
            onClick={() => {
              setDone(false);
              onClose();
            }}
          >
            {tc("close")}
          </Button>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate();
          }}
        >
          <Field label={t("email")} htmlFor="inv-email">
            <Input
              id="inv-email"
              type="email"
              dir="ltr"
              required
              placeholder={t("invitePlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label={t("role")} htmlFor="inv-role">
            <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {tr(r)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button type="submit" loading={invite.isPending}>
              {t("send")}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc("cancel")}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

// --------------------------------------------------------------------- //
// Integrations (GitLab)                                                 //
// --------------------------------------------------------------------- //
function IntegrationsTab() {
  const t = useTranslations("dashboard.settings.integrations");
  const tc = useTranslations("common");
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const qc = useQueryClient();
  const { error, handle, setError } = useApiError();
  const [baseUrl, setBaseUrl] = React.useState("https://gitlab.com");
  const [token, setToken] = React.useState("");
  const [repos, setRepos] = React.useState<Record<string, Repository[]>>({});

  const { data } = useQuery({
    queryKey: ["integrations", orgId],
    queryFn: async () => unwrapList(await api.integrations.list(orgId as string)),
    enabled: !!orgId,
  });
  const integrations: Integration[] = data ?? [];
  const gitlab = integrations.find((i) => i.provider === "gitlab");

  const connect = useMutation({
    mutationFn: () =>
      api.integrations.create(orgId as string, {
        provider: "gitlab",
        name: "GitLab",
        base_url: baseUrl,
        access_token: token,
      }),
    onSuccess: () => {
      setToken("");
      qc.invalidateQueries({ queryKey: ["integrations", orgId] });
    },
    onError: handle,
  });

  const sync = useMutation({
    mutationFn: (id: string) => api.integrations.sync(orgId as string, id),
    onSuccess: (data, id) => setRepos((r) => ({ ...r, [id]: data })),
    onError: handle,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.integrations.remove(orgId as string, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations", orgId] }),
    onError: handle,
  });

  if (!orgId) return null;

  return (
    <div className="space-y-4">
      <TabError message={error} />

      <Card className="p-5">
        <div className="flex items-center gap-2">
          <Gitlab className="h-5 w-5 text-accent" />
          <h3 className="font-semibold">{t("gitlab")}</h3>
          {gitlab?.connected && <Badge variant="success">{t("connected")}</Badge>}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("gitlabDesc")}</p>

        {gitlab ? (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between rounded-[var(--radius-sm)] border border-border px-3 py-2">
              <span className="text-sm" dir="ltr">
                {gitlab.base_url}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  loading={sync.isPending}
                  onClick={() => sync.mutate(gitlab.id)}
                >
                  <RefreshCw className="h-4 w-4" />
                  {t("sync")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove.mutate(gitlab.id)}
                  aria-label={tc("delete")}
                >
                  <Trash2 className="h-4 w-4 text-danger" />
                </Button>
              </div>
            </div>
            {(repos[gitlab.id]?.length ?? 0) > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  {t("repositories")} ({repos[gitlab.id].length})
                </div>
                <ul className="max-h-48 space-y-1 overflow-auto text-sm" dir="ltr">
                  {repos[gitlab.id].map((r) => (
                    <li key={r.id} className="rounded px-2 py-1 hover:bg-muted">
                      {r.path_with_namespace}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              connect.mutate();
            }}
          >
            <Field label={t("baseUrl")} htmlFor="gl-url">
              <Input
                id="gl-url"
                dir="ltr"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </Field>
            <Field label={t("token")} htmlFor="gl-token">
              <Input
                id="gl-token"
                type="password"
                dir="ltr"
                required
                placeholder={t("tokenPlaceholder")}
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" loading={connect.isPending}>
                {t("connect")}
              </Button>
            </div>
          </form>
        )}
      </Card>

      <Card className="flex items-start gap-4 p-5 opacity-70">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-muted">
          <Github className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{t("github")}</h3>
            <Badge variant="muted">{tc("comingSoon")}</Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("githubDesc")}</p>
        </div>
      </Card>
    </div>
  );
}

// --------------------------------------------------------------------- //
// Webhooks & alert rules                                                //
// --------------------------------------------------------------------- //
function WebhooksTab() {
  const t = useTranslations("dashboard.settings.webhooks");
  const tc = useTranslations("common");
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const qc = useQueryClient();
  const { error, handle, setError } = useApiError();

  const channelsQ = useQuery({
    queryKey: ["channels", orgId],
    queryFn: async () => unwrapList(await api.channels.list(orgId as string)),
    enabled: !!orgId,
  });
  const rulesQ = useQuery({
    queryKey: ["alert-rules", orgId],
    queryFn: async () => unwrapList(await api.alertRules.list(orgId as string)),
    enabled: !!orgId,
  });
  const channels: NotificationChannel[] = channelsQ.data ?? [];
  const rules: AlertRule[] = rulesQ.data ?? [];

  // New-channel form state.
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<ChannelType>("webhook");
  const [target, setTarget] = React.useState("");
  const [template, setTemplate] = React.useState("");

  const addChannel = useMutation({
    mutationFn: () => {
      const isUrl = type === "webhook" || type === "mattermost";
      const base = isUrl
        ? { url: target.trim() }
        : {
            to: target
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          };
      const config: Record<string, unknown> = { ...base };
      if (template.trim()) config.template = template;
      return api.channels.create(orgId as string, { name, type, config });
    },
    onSuccess: () => {
      setName("");
      setTarget("");
      setTemplate("");
      qc.invalidateQueries({ queryKey: ["channels", orgId] });
    },
    onError: handle,
  });
  const removeChannel = useMutation({
    mutationFn: (id: string) => api.channels.remove(orgId as string, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["channels", orgId] }),
    onError: handle,
  });

  // New-rule form state.
  const [event, setEvent] = React.useState<AlertEventType>("issue.created");
  const [channelId, setChannelId] = React.useState("");
  const addRule = useMutation({
    mutationFn: () =>
      api.alertRules.create(orgId as string, { event_type: event, channel: channelId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-rules", orgId] }),
    onError: handle,
  });
  const removeRule = useMutation({
    mutationFn: (id: string) => api.alertRules.remove(orgId as string, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-rules", orgId] }),
    onError: handle,
  });

  React.useEffect(() => {
    if (!channelId && channels[0]) setChannelId(channels[0].id);
  }, [channels, channelId]);

  if (!orgId) return null;
  const isUrlType = type === "webhook" || type === "mattermost";

  return (
    <div className="space-y-4">
      <TabError message={error} />

      {/* Channels */}
      <Card>
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <Bell className="h-4 w-4 text-accent" />
          <h2 className="font-semibold">{t("channelsTitle")}</h2>
        </div>
        <form
          className="grid gap-3 px-5 py-4 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            addChannel.mutate();
          }}
        >
          <Field label={t("name")} htmlFor="ch-name">
            <Input id="ch-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("type")} htmlFor="ch-type">
            <Select
              id="ch-type"
              value={type}
              onChange={(e) => setType(e.target.value as ChannelType)}
            >
              {CHANNEL_TYPES.map((c) => (
                <option key={c} value={c}>
                  {t(`channelTypes.${c}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={isUrlType ? t("url") : t("recipients")} htmlFor="ch-target">
            <Input
              id="ch-target"
              dir="ltr"
              required
              value={target}
              placeholder={isUrlType ? "https://…" : "a@b.com, …"}
              onChange={(e) => setTarget(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" loading={addChannel.isPending} className="w-full">
              <Plus className="h-4 w-4" />
              {t("add")}
            </Button>
          </div>
          <div className="sm:col-span-4">
            <Field
              label={type === "webhook" ? t("payloadTemplate") : t("messageTemplate")}
              htmlFor="ch-template"
            >
              <textarea
                id="ch-template"
                dir="ltr"
                rows={type === "webhook" ? 8 : 3}
                value={template}
                placeholder={type === "webhook" ? DEFAULT_WEBHOOK_TEMPLATE : DEFAULT_TEXT_TEMPLATE}
                onChange={(e) => setTemplate(e.target.value)}
                className="flex w-full rounded-[var(--radius-sm)] border border-border bg-input px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              />
            </Field>
            <p className="mt-1 text-xs text-muted-foreground">{t("templateHint")}</p>
          </div>
        </form>
        {channels.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState icon={<Bell className="h-7 w-7" />} message={t("empty")} />
          </div>
        ) : (
          <Table>
            <TBody>
              {channels.map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium">{c.name}</TD>
                  <TD>
                    <Badge variant="muted">{t(`channelTypes.${c.type}`)}</Badge>
                  </TD>
                  <TD className="text-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeChannel.mutate(c.id)}
                      aria-label={tc("delete")}
                    >
                      <Trash2 className="h-4 w-4 text-danger" />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {/* Alert rules */}
      <Card>
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <ShieldCheck className="h-4 w-4 text-accent" />
          <h2 className="font-semibold">{t("rulesTitle")}</h2>
        </div>
        <form
          className="grid gap-3 px-5 py-4 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            addRule.mutate();
          }}
        >
          <Field label={t("event")} htmlFor="rule-event">
            <Select
              id="rule-event"
              value={event}
              onChange={(e) => setEvent(e.target.value as AlertEventType)}
            >
              {EVENT_TYPES.map((ev) => (
                <option key={ev} value={ev}>
                  {t(`events.${slug(ev)}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("channel")} htmlFor="rule-channel">
            <Select
              id="rule-channel"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button
              type="submit"
              className="w-full"
              loading={addRule.isPending}
              disabled={channels.length === 0}
            >
              <Plus className="h-4 w-4" />
              {t("addRule")}
            </Button>
          </div>
        </form>
        {rules.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState icon={<Bell className="h-7 w-7" />} message={t("rulesEmpty")} />
          </div>
        ) : (
          <Table>
            <TBody>
              {rules.map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium">{t(`events.${slug(r.event_type)}`)}</TD>
                  <TD className="text-muted-foreground">
                    {channels.find((c) => c.id === r.channel)?.name ?? r.channel}
                  </TD>
                  <TD className="text-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeRule.mutate(r.id)}
                      aria-label={tc("delete")}
                    >
                      <Trash2 className="h-4 w-4 text-danger" />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <DeliveryLog orgId={orgId} />
    </div>
  );
}

const LOGS_PAGE_SIZE = 50;

function DeliveryLog({ orgId }: { orgId: string }) {
  const t = useTranslations("dashboard.settings.webhooks");
  const tc = useTranslations("common");
  const tch = useTranslations("dashboard.settings.webhooks.channelTypes");
  const tev = useTranslations("dashboard.settings.webhooks.events");
  const tpag = useTranslations("dashboard.issues.pagination");
  const locale = useLocale();
  const qc = useQueryClient();
  const { handle } = useApiError();

  const [success, setSuccess] = React.useState<"" | "true" | "false">("");
  const [channel, setChannel] = React.useState<ChannelType | "">("");
  const [event, setEvent] = React.useState<AlertEventType | "">("");
  const [offset, setOffset] = React.useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally resets paging when filters change
  React.useEffect(() => setOffset(0), [success, channel, event]);

  const { data } = useQuery({
    queryKey: ["notification-logs", orgId, success, channel, event, offset],
    queryFn: () =>
      api.notificationLogs.list(orgId, {
        success: success || undefined,
        channel_type: channel || undefined,
        event_type: event || undefined,
        limit: LOGS_PAGE_SIZE,
        offset,
      }),
    enabled: !!orgId,
  });

  const logs: NotificationLog[] = data ? unwrapList(data) : [];
  const total = data && !Array.isArray(data) ? data.count : logs.length;

  const replay = useMutation({
    mutationFn: (id: string) => api.notificationLogs.replay(orgId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-logs", orgId] }),
    onError: handle,
  });

  // The API event_type uses dots ("issue.created"); the message keys use
  // underscores ("issue_created").
  const eventLabel = (e: string) => tev(e.replace(/\./g, "_"));

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + LOGS_PAGE_SIZE, total);
  const hasPrev = offset > 0;
  const hasNext = offset + LOGS_PAGE_SIZE < total;
  const hasFilters = !!success || !!channel || !!event;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
        <Bell className="h-4 w-4 text-accent" />
        <h2 className="font-semibold">{t("deliveriesTitle")}</h2>
        <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
          <Select
            value={success}
            onChange={(e) => setSuccess(e.target.value as "" | "true" | "false")}
            aria-label={t("statusCol")}
            className="h-8 text-xs"
          >
            <option value="">{t("filterAllStatuses")}</option>
            <option value="true">{t("delivered")}</option>
            <option value="false">{t("failed")}</option>
          </Select>
          <Select
            value={channel}
            onChange={(e) => setChannel(e.target.value as ChannelType | "")}
            aria-label={t("type")}
            className="h-8 text-xs"
          >
            <option value="">{t("filterAllChannels")}</option>
            {CHANNEL_TYPES.map((c) => (
              <option key={c} value={c}>
                {tch(c)}
              </option>
            ))}
          </Select>
          <Select
            value={event}
            onChange={(e) => setEvent(e.target.value as AlertEventType | "")}
            aria-label={t("event")}
            className="h-8 text-xs"
          >
            <option value="">{t("filterAllEvents")}</option>
            {EVENT_TYPES.map((e) => (
              <option key={e} value={e}>
                {eventLabel(e)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {logs.length === 0 ? (
        <div className="px-5 pb-5">
          <EmptyState
            icon={<Bell className="h-7 w-7" />}
            message={hasFilters ? t("deliveriesNoMatch") : t("deliveriesEmpty")}
          />
        </div>
      ) : (
        <>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>{t("statusCol")}</TH>
                <TH>{t("channel")}</TH>
                <TH className="hidden sm:table-cell">{t("event")}</TH>
                <TH className="hidden md:table-cell">{t("sentAt")}</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {logs.map((log) => (
                <TR key={log.id}>
                  <TD>
                    <Badge variant={log.success ? "success" : "danger"}>
                      {log.success ? t("delivered") : t("failed")}
                    </Badge>
                  </TD>
                  <TD className="text-muted-foreground">{tch(log.channel_type)}</TD>
                  <TD className="hidden text-xs text-muted-foreground sm:table-cell">
                    {eventLabel(log.event_type)}
                  </TD>
                  <TD className="hidden whitespace-nowrap text-xs text-muted-foreground md:table-cell">
                    {formatDateTime(log.created_at, locale)}
                  </TD>
                  <TD className="text-end">
                    {!log.success && (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={replay.isPending}
                        onClick={() => replay.mutate(log.id)}
                      >
                        <RefreshCw className="h-4 w-4" />
                        {tc("retry")}
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {total > 0 && (
            <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {tpag("showing", {
                  from: localizeDigits(from, locale),
                  to: localizeDigits(to, locale),
                  total: localizeDigits(total, locale),
                })}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasPrev}
                  onClick={() => setOffset(Math.max(0, offset - LOGS_PAGE_SIZE))}
                >
                  <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
                  {tpag("prev")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasNext}
                  onClick={() => setOffset(offset + LOGS_PAGE_SIZE)}
                >
                  {tpag("next")}
                  <ChevronRight className="h-4 w-4 rtl:rotate-180" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// --------------------------------------------------------------------- //
// AI configuration                                                      //
// --------------------------------------------------------------------- //
// Only the OpenAI-compatible provider exposes a custom base URL; Claude and
// Cursor go through their official SDKs. All providers require an API key.
const usesBaseUrl = (p: AIProviderType) => p === "openai";

function AiTab() {
  const t = useTranslations("dashboard.settings.ai");
  const tc = useTranslations("common");
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const qc = useQueryClient();
  const { error, handle } = useApiError();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AIConfig | null>(null);

  const { data } = useQuery({
    queryKey: ["ai-configs", orgId],
    queryFn: async () => unwrapList(await api.aiConfigs.list(orgId as string)),
    enabled: !!orgId,
  });
  const agents: AIConfig[] = data ?? [];

  const remove = useMutation({
    mutationFn: (id: string) => api.aiConfigs.remove(orgId as string, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-configs", orgId] }),
    onError: handle,
  });

  if (!orgId) return null;

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(agent: AIConfig) {
    setEditing(agent);
    setDialogOpen(true);
  }

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="font-semibold">{t("title")}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("desc")}</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          {t("addAgent")}
        </Button>
      </div>
      <div className="px-5 pt-3">
        <TabError message={error} />
      </div>

      {agents.length === 0 ? (
        <div className="px-5 pb-5">
          <EmptyState icon={<Bell className="h-7 w-7" />} message={t("empty")} />
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {agents.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-4">
              <button
                type="button"
                onClick={() => openEdit(a)}
                className="flex min-w-0 flex-1 items-center gap-3 text-start"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">
                      {a.name || t(`providers.${a.provider}`)}
                    </span>
                    {!a.enabled && <Badge variant="muted">{t("disabled")}</Badge>}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {t(`providers.${a.provider}`)} · {a.model}
                    {!a.has_key && ` · ${t("keyNeeded")}`}
                  </span>
                </span>
              </button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => remove.mutate(a.id)}
                aria-label={tc("delete")}
              >
                <Trash2 className="h-4 w-4 text-danger" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AgentDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        orgId={orgId}
        agent={editing}
        onError={handle}
      />
    </Card>
  );
}

function AgentDialog({
  open,
  onClose,
  orgId,
  agent,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  agent: AIConfig | null;
  onError: (e: unknown) => void;
}) {
  const t = useTranslations("dashboard.settings.ai");
  const tc = useTranslations("common");
  const qc = useQueryClient();

  const [name, setName] = React.useState("");
  const [provider, setProvider] = React.useState<AIProviderType>("claude");
  const [model, setModel] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [autoTrigger, setAutoTrigger] = React.useState(false);
  const [enabled, setEnabled] = React.useState(true);

  // Seed the form whenever the dialog opens (create → blank, edit → agent).
  React.useEffect(() => {
    if (!open) return;
    setName(agent?.name ?? "");
    setProvider(agent?.provider ?? "claude");
    setModel(agent?.model ?? "");
    setBaseUrl(agent?.base_url ?? "");
    setApiKey("");
    setAutoTrigger(agent?.auto_trigger ?? false);
    setEnabled(agent?.enabled ?? true);
  }, [open, agent]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        provider,
        model,
        auto_trigger: autoTrigger,
        enabled,
        // Base URL only applies to the OpenAI-compatible provider.
        ...(usesBaseUrl(provider) ? { base_url: baseUrl } : {}),
        // Send the key only when the user typed a new one (keeps the stored key).
        ...(apiKey ? { api_key: apiKey } : {}),
      };
      return agent
        ? api.aiConfigs.update(orgId, agent.id, body)
        : api.aiConfigs.create(orgId, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-configs", orgId] });
      onClose();
    },
    onError,
  });

  const showBaseUrl = usesBaseUrl(provider);

  return (
    <Dialog open={open} onClose={onClose} title={agent ? t("editAgent") : t("addAgent")}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("name")} htmlFor="ai-name">
            <Input
              id="ai-name"
              value={name}
              placeholder={t("namePlaceholder")}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label={t("provider")} htmlFor="ai-provider">
            <Select
              id="ai-provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value as AIProviderType)}
            >
              {AI_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {t(`providers.${p}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("model")} htmlFor="ai-model">
            <Input
              id="ai-model"
              placeholder="claude-opus-4-8"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </Field>
          {showBaseUrl && (
            <Field label={t("baseUrl")} htmlFor="ai-base">
              <Input
                id="ai-base"
                dir="ltr"
                placeholder="https://api.openai.com/v1"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </Field>
          )}
          <Field label={t("apiKey")} htmlFor="ai-key">
            <Input
              id="ai-key"
              type="password"
              dir="ltr"
              placeholder={agent?.has_key ? t("keySet") : "sk-…"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>
        </div>

        <p className="text-xs text-muted-foreground">{t("keyHint")}</p>

        <div className="flex items-center gap-3">
          <Checkbox
            checked={autoTrigger}
            onCheckedChange={setAutoTrigger}
            aria-label={t("autoTrigger")}
          />
          <span className="text-sm font-medium">{t("autoTrigger")}</span>
        </div>
        <div className="flex items-center gap-3">
          <Checkbox
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label={t("autofixEnabled")}
          />
          <span className="text-sm font-medium">{t("autofixEnabled")}</span>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {tc("save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

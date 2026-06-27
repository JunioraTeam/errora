"use client";

import { useMutation } from "@tanstack/react-query";
import { KeyRound, ShieldCheck, User as UserIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { useAuth } from "@/components/providers/AuthProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  Field,
  Input,
  isValidIranMobile,
  PhoneInput,
  toNationalMobile,
} from "@/components/ui/Input";
import { ApiError, api, fieldErrors } from "@/lib/api";

export default function ProfilePage() {
  const t = useTranslations("dashboard.profile");

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="grid gap-5 p-5 sm:p-8 lg:grid-cols-2">
        <PersonalInfoCard />
        <PasswordCard />
        <TotpCard />
      </div>
    </div>
  );
}

function useFormError() {
  const [error, setError] = React.useState<string | null>(null);
  const handle = React.useCallback((e: unknown) => {
    setError(e instanceof ApiError ? e.message : "Request failed");
  }, []);
  return { error, setError, handle };
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-[var(--radius-sm)] bg-danger/10 px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

function PersonalInfoCard() {
  const t = useTranslations("dashboard.profile");
  const { user, refreshUser } = useAuth();
  const { error, setError } = useFormError();
  const [fieldErr, setFieldErr] = React.useState<Record<string, string>>({});
  const [done, setDone] = React.useState(false);

  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");

  React.useEffect(() => {
    if (!user) return;
    setFirstName(user.first_name ?? "");
    setLastName(user.last_name ?? "");
    setEmail(user.email ?? "");
    setPhone(toNationalMobile(user.phone));
  }, [user]);

  const save = useMutation({
    mutationFn: () =>
      api.auth.updateProfile({
        first_name: firstName,
        last_name: lastName,
        email: email || null,
        phone: phone || null,
      }),
    onSuccess: async () => {
      setDone(true);
      await refreshUser();
    },
    onError: (e) => {
      // Show DRF per-field validation errors under each input; surface any
      // form-level message (or a generic fallback) at the top of the form.
      const fe = fieldErrors(e);
      setFieldErr(fe);
      setError(
        fe.__all__ ?? (e instanceof ApiError && Object.keys(fe).length === 0 ? e.message : null)
      );
    },
  });

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <UserIcon className="h-4 w-4 text-accent" />
        {t("infoTitle")}
      </h2>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setFieldErr({});
          setDone(false);
          if (phone && !isValidIranMobile(phone)) {
            setFieldErr({ phone: t("invalidPhone") });
            return;
          }
          save.mutate();
        }}
      >
        <FormError message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("firstName")} htmlFor="first-name" error={fieldErr.first_name}>
            <Input
              id="first-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </Field>
          <Field label={t("lastName")} htmlFor="last-name" error={fieldErr.last_name}>
            <Input id="last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
          <Field label={t("email")} htmlFor="email" error={fieldErr.email}>
            <Input
              id="email"
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label={t("phone")} htmlFor="phone" error={fieldErr.phone}>
            <PhoneInput
              id="phone"
              value={phone}
              onChange={setPhone}
              invalid={!!phone && !isValidIranMobile(phone)}
            />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" loading={save.isPending}>
            {t("save")}
          </Button>
          {done && <span className="text-sm text-success">{t("saved")}</span>}
        </div>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const t = useTranslations("dashboard.profile");
  const { user, setTokens } = useAuth();
  const { error, setError, handle } = useFormError();
  const [done, setDone] = React.useState(false);

  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");

  const hasPassword = user?.has_password ?? true;

  const save = useMutation({
    mutationFn: () =>
      api.auth.changePassword({
        ...(hasPassword ? { current_password: current } : {}),
        new_password: next,
      }),
    onSuccess: async (res) => {
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
      await setTokens(res.tokens);
    },
    onError: handle,
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next !== confirm) {
      setError(t("passwordMismatch"));
      return;
    }
    save.mutate();
  }

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <KeyRound className="h-4 w-4 text-accent" />
        {t("passwordTitle")}
      </h2>
      <form className="mt-4 space-y-4" onSubmit={submit}>
        <FormError message={error} />
        {hasPassword && (
          <Field label={t("currentPassword")} htmlFor="cur-pass">
            <Input
              id="cur-pass"
              type="password"
              dir="ltr"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
        )}
        <Field label={t("newPassword")} htmlFor="new-pass">
          <Input
            id="new-pass"
            type="password"
            dir="ltr"
            required
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label={t("confirmPassword")} htmlFor="confirm-pass">
          <Input
            id="confirm-pass"
            type="password"
            dir="ltr"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" loading={save.isPending}>
            {t("changePassword")}
          </Button>
          {done && <span className="text-sm text-success">{t("passwordSaved")}</span>}
        </div>
      </form>
    </Card>
  );
}

function TotpCard() {
  const t = useTranslations("dashboard.profile");
  const { user, refreshUser } = useAuth();
  const { error, setError, handle } = useFormError();
  const enabled = user?.totp_enabled ?? false;

  const [setup, setSetup] = React.useState<{
    secret: string;
    otpauth_uri: string;
  } | null>(null);
  const [code, setCode] = React.useState("");
  const [disableValue, setDisableValue] = React.useState("");

  const begin = useMutation({
    mutationFn: () => api.auth.totpSetup(),
    onSuccess: (res) => setSetup(res),
    onError: handle,
  });
  const enable = useMutation({
    mutationFn: () => api.auth.totpEnable(code),
    onSuccess: async () => {
      setSetup(null);
      setCode("");
      await refreshUser();
    },
    onError: handle,
  });
  const disable = useMutation({
    mutationFn: () =>
      api.auth.totpDisable(
        /^\d+$/.test(disableValue.trim())
          ? { code: disableValue.trim() }
          : { password: disableValue }
      ),
    onSuccess: async () => {
      setDisableValue("");
      await refreshUser();
    },
    onError: handle,
  });

  return (
    <Card className="p-5 lg:col-span-2">
      <h2 className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="h-4 w-4 text-accent" />
        {t("totpTitle")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("totpDesc")}</p>
      <div className="mt-3">
        <Badge variant={enabled ? "success" : "muted"}>
          {enabled ? t("totpEnabled") : t("totpDisabled")}
        </Badge>
      </div>
      <div className="mt-4 space-y-4">
        <FormError message={error} />

        {enabled ? (
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              disable.mutate();
            }}
          >
            <Field label={t("totpDisablePrompt")} htmlFor="totp-disable">
              <Input
                id="totp-disable"
                dir="ltr"
                value={disableValue}
                onChange={(e) => setDisableValue(e.target.value)}
                className="sm:w-72"
              />
            </Field>
            <Button type="submit" variant="danger" loading={disable.isPending}>
              {t("totpDisable")}
            </Button>
          </form>
        ) : setup ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("totpScan")}</p>
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">{t("totpSecret")}</span>
              <code className="block break-all rounded-[var(--radius-sm)] border border-border bg-muted px-3 py-2 font-mono text-sm">
                {setup.secret}
              </code>
              <code className="block break-all rounded-[var(--radius-sm)] border border-border bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
                {setup.otpauth_uri}
              </code>
            </div>
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                enable.mutate();
              }}
            >
              <Field label={t("totpCode")} htmlFor="totp-code">
                <Input
                  id="totp-code"
                  dir="ltr"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="sm:w-44"
                />
              </Field>
              <Button type="submit" loading={enable.isPending}>
                {t("totpEnable")}
              </Button>
            </form>
          </div>
        ) : (
          <Button
            onClick={() => {
              setError(null);
              begin.mutate();
            }}
            loading={begin.isPending}
          >
            {t("totpSetup")}
          </Button>
        )}
      </div>
    </Card>
  );
}

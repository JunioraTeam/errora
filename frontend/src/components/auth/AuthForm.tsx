"use client";

import { ArrowLeft, KeyRound, Lock, Mail } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Field, Input, isValidEmail } from "@/components/ui/Input";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useRouter } from "@/i18n/routing";
import { ApiError, api } from "@/lib/api";
import { OTP_ENABLED } from "@/lib/config";
import { cn } from "@/lib/utils";

type Method = "password" | "otp";

/**
 * Unified auth screen: a single email + password form that logs in an existing
 * account or registers a new one (the backend decides). Name is NOT collected
 * here — users set it later on the dashboard profile page.
 */
export function AuthForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const { setSession } = useAuth();

  const [method, setMethod] = React.useState<Method>("password");
  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [totp, setTotp] = React.useState("");
  const [totpRequired, setTotpRequired] = React.useState(false);
  const [otpSent, setOtpSent] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function fail(e: unknown) {
    if (e instanceof ApiError && e.status === 401) {
      setError(t("errors.invalidCredentials"));
    } else if (e instanceof ApiError && e.message) {
      setError(e.message);
    } else {
      setError(t("errors.generic"));
    }
  }

  async function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!identifier || !password) {
      setError(t("errors.required"));
      return;
    }
    if (!isValidEmail(identifier)) {
      setError(t("errors.invalidEmail"));
      return;
    }
    setLoading(true);
    try {
      const res = await api.auth.access({
        identifier,
        password,
        ...(totpRequired ? { totp } : {}),
      });
      setSession(res);
      router.push("/dashboard");
    } catch (e) {
      if (e instanceof ApiError && e.status === 400 && e.body && typeof e.body === "object") {
        const body = e.body as Record<string, unknown>;
        // A 2FA-enabled account answers the first attempt with a TOTP challenge.
        if ("totp_required" in body) {
          setTotpRequired(true);
          setError(t("totpRequired"));
          return;
        }
        if ("totp" in body) {
          setTotpRequired(true);
          setError(t("errors.invalidTotp"));
          return;
        }
        if ("signup_disabled" in body) {
          setError(t("errors.signupDisabled"));
          return;
        }
        // Unknown identifier with a wrong/short password, or bad credentials.
        setError(t("errors.invalidCredentials"));
        return;
      }
      fail(e);
    } finally {
      setLoading(false);
    }
  }

  async function onRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidEmail(identifier)) {
      setError(t("errors.invalidEmail"));
      return;
    }
    setLoading(true);
    try {
      await api.auth.requestOtp({ identifier });
      setOtpSent(true);
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }

  async function onVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!code) {
      setError(t("errors.required"));
      return;
    }
    setLoading(true);
    try {
      const res = await api.auth.verifyOtp({ identifier, code });
      setSession(res);
      router.push("/dashboard");
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col bg-background">
      <div className="pointer-events-none absolute inset-0 -z-10 glow-accent opacity-60" />

      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <button type="button" onClick={() => router.push("/")} className="cursor-pointer">
          <Logo />
        </button>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md rounded-[var(--radius-lg)] border border-border bg-card p-7 shadow-lg"
        >
          <h1 className="text-2xl font-bold tracking-tight">{t("access.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("access.subtitle")}</p>

          {/* Method toggle — hidden when OTP login is disabled via env. */}
          {OTP_ENABLED && (
            <div className="mt-6 inline-flex w-full rounded-[var(--radius-sm)] border border-border bg-muted p-1">
              {(["password", "otp"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMethod(m);
                    setError(null);
                    setOtpSent(false);
                  }}
                  className={cn(
                    "flex-1 rounded-[calc(var(--radius-sm)-0.25rem)] px-3 py-1.5 text-sm font-medium transition-colors",
                    method === m
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {m === "password" ? t("methodPassword") : t("methodOtp")}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-[var(--radius-sm)] border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          <AnimatePresence mode="wait">
            {method === "password" ? (
              <motion.form
                key="password"
                onSubmit={onPasswordSubmit}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mt-5 space-y-4"
              >
                <Field label={t("fields.email")} htmlFor="identifier">
                  <div dir="ltr" className="relative">
                    <Mail className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="identifier"
                      type="email"
                      dir="ltr"
                      autoComplete="email"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder={t("fields.emailPlaceholder")}
                      className="ps-9"
                    />
                  </div>
                </Field>
                <Field label={t("fields.password")} htmlFor="password">
                  <div dir="ltr" className="relative">
                    <Lock className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t("fields.passwordPlaceholder")}
                      className="ps-9"
                      dir="ltr"
                      autoComplete="current-password"
                    />
                  </div>
                </Field>
                {totpRequired && (
                  <Field label={t("fields.totp")} htmlFor="login-totp">
                    <div dir="ltr" className="relative">
                      <KeyRound className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="login-totp"
                        value={totp}
                        onChange={(e) => setTotp(e.target.value)}
                        placeholder={t("fields.totpPlaceholder")}
                        className="ps-9 tracking-[0.4em]"
                        dir="ltr"
                        inputMode="numeric"
                        maxLength={6}
                        autoFocus
                      />
                    </div>
                  </Field>
                )}
                <Button type="submit" className="w-full" loading={loading}>
                  {t("access.submit")}
                </Button>
              </motion.form>
            ) : (
              <motion.div
                key="otp"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mt-5 space-y-4"
              >
                {!otpSent ? (
                  <form onSubmit={onRequestOtp} className="space-y-4">
                    <Field label={t("fields.email")} htmlFor="otp-identifier">
                      <div dir="ltr" className="relative">
                        <Mail className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="otp-identifier"
                          type="email"
                          dir="ltr"
                          autoComplete="email"
                          value={identifier}
                          onChange={(e) => setIdentifier(e.target.value)}
                          placeholder={t("fields.emailPlaceholder")}
                          className="ps-9"
                        />
                      </div>
                    </Field>
                    <Button type="submit" className="w-full" loading={loading}>
                      {t("otp.request")}
                    </Button>
                  </form>
                ) : (
                  <form onSubmit={onVerifyOtp} className="space-y-4">
                    <p className="rounded-[var(--radius-sm)] bg-accent-soft px-3 py-2 text-sm text-accent">
                      {t("otp.hint", { identifier })}
                    </p>
                    <Field label={t("fields.code")} htmlFor="otp-code">
                      <div dir="ltr" className="relative">
                        <KeyRound className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="otp-code"
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                          placeholder={t("fields.codePlaceholder")}
                          className="ps-9 tracking-[0.4em]"
                          dir="ltr"
                          inputMode="numeric"
                          maxLength={6}
                        />
                      </div>
                    </Field>
                    <Button type="submit" className="w-full" loading={loading}>
                      {t("otp.verify")}
                    </Button>
                    <div className="flex items-center justify-between text-sm">
                      <button
                        type="button"
                        onClick={() => setOtpSent(false)}
                        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                      >
                        <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" />
                        {t("otp.changeIdentifier")}
                      </button>
                      <button
                        type="button"
                        onClick={onRequestOtp}
                        className="text-accent hover:underline"
                      >
                        {t("otp.resend")}
                      </button>
                    </div>
                  </form>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <p className="mt-6 text-center text-xs text-muted-foreground">{t("access.hint")}</p>
        </motion.div>
      </main>
    </div>
  );
}

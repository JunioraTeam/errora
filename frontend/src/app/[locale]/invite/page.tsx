"use client";

import { CheckCircle2, Loader2, MailWarning, ShieldAlert } from "lucide-react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/Button";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useRouter } from "@/i18n/routing";
import { ApiError, api } from "@/lib/api";
import type { InvitePreview } from "@/lib/types";

type Phase = "loading" | "ready" | "joining" | "done" | "invalid" | "wrong" | "error";

/**
 * Invite accept landing (`/invite?token=…`). Public route: an invited person may
 * not have an account yet. It previews the invite, then either prompts sign-in
 * (carrying the token + invited email back through auth) or — once the user is
 * signed in with the matching email — accepts it and forwards to the dashboard.
 */
export default function InvitePage() {
  const t = useTranslations("invite");
  const router = useRouter();
  const { isLoading: authLoading, isAuthenticated, user, signOut } = useAuth();

  const [token, setToken] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<InvitePreview | null>(null);
  const [phase, setPhase] = React.useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // 1. Read the token from the URL once on mount.
  React.useEffect(() => {
    const tk = new URLSearchParams(window.location.search).get("token");
    if (!tk) {
      setPhase("invalid");
      return;
    }
    setToken(tk);
  }, []);

  // 2. Fetch the public preview.
  React.useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.orgs
      .previewInvite(token)
      .then((p) => !cancelled && setPreview(p))
      .catch(() => !cancelled && setPhase("invalid"));
    return () => {
      cancelled = true;
    };
  }, [token]);

  // 3. Once preview + auth state are known, decide the next step.
  React.useEffect(() => {
    if (!token || !preview || authLoading) return;
    const emailMatches = !!user?.email && user.email.toLowerCase() === preview.email.toLowerCase();

    if (!isAuthenticated) {
      setPhase(preview.valid ? "ready" : "invalid");
      return;
    }
    if (!emailMatches) {
      setPhase("wrong");
      return;
    }
    if (preview.status === "accepted") {
      // Auto-joined at signup, or a repeat visit — already a member.
      setPhase("done");
      return;
    }
    if (!preview.valid) {
      setPhase("invalid");
      return;
    }
    setPhase("joining");
    api.orgs
      .acceptInvite(token)
      .then(() => setPhase("done"))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 403) {
          setPhase("wrong");
        } else {
          setErrorMsg(e instanceof ApiError ? e.message : null);
          setPhase("error");
        }
      });
  }, [token, preview, authLoading, isAuthenticated, user]);

  // 4. After joining, forward to the dashboard.
  React.useEffect(() => {
    if (phase !== "done") return;
    const id = setTimeout(() => router.push("/dashboard"), 1200);
    return () => clearTimeout(id);
  }, [phase, router]);

  function goSignIn() {
    const next = `/invite?token=${encodeURIComponent(token ?? "")}`;
    const email = preview?.email ? `&email=${encodeURIComponent(preview.email)}` : "";
    router.push(`/login?next=${encodeURIComponent(next)}${email}`);
  }

  const org = preview?.organization_name ?? "";
  const email = preview?.email ?? "";

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
          className="w-full max-w-md rounded-[var(--radius-lg)] border border-border bg-card p-7 text-center shadow-lg"
        >
          {(phase === "loading" || phase === "joining") && (
            <div className="space-y-4 py-6">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-accent" />
              <p className="text-sm text-muted-foreground">
                {phase === "joining" ? t("joining", { org }) : t("loading")}
              </p>
            </div>
          )}

          {phase === "done" && (
            <div className="space-y-3 py-4">
              <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
              <h1 className="text-xl font-bold tracking-tight">{t("joinedTitle")}</h1>
              <p className="text-sm text-muted-foreground">{t("joinedBody", { org })}</p>
            </div>
          )}

          {phase === "ready" && (
            <div className="space-y-5 py-2">
              <h1 className="text-2xl font-bold tracking-tight">{t("signInTitle", { org })}</h1>
              <p className="text-sm text-muted-foreground">{t("signInBody", { org, email })}</p>
              <Button className="w-full" onClick={goSignIn}>
                {t("signInCta")}
              </Button>
            </div>
          )}

          {phase === "wrong" && (
            <div className="space-y-4 py-2">
              <ShieldAlert className="mx-auto h-10 w-10 text-danger" />
              <h1 className="text-xl font-bold tracking-tight">{t("wrongTitle")}</h1>
              <p className="text-sm text-muted-foreground">{t("wrongBody", { email })}</p>
              <Button variant="secondary" className="w-full" onClick={signOut}>
                {t("switchAccount")}
              </Button>
            </div>
          )}

          {phase === "invalid" && (
            <div className="space-y-4 py-2">
              <MailWarning className="mx-auto h-10 w-10 text-warning" />
              <h1 className="text-xl font-bold tracking-tight">{t("invalidTitle")}</h1>
              <p className="text-sm text-muted-foreground">{t("invalidBody")}</p>
              <Button variant="secondary" className="w-full" onClick={() => router.push("/")}>
                {t("toDashboard")}
              </Button>
            </div>
          )}

          {phase === "error" && (
            <div className="space-y-4 py-2">
              <MailWarning className="mx-auto h-10 w-10 text-danger" />
              <h1 className="text-xl font-bold tracking-tight">{t("errorTitle")}</h1>
              <p className="text-sm text-muted-foreground">{errorMsg ?? t("errorBody")}</p>
            </div>
          )}
        </motion.div>
      </main>
    </div>
  );
}

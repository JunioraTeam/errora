"use client";

import {
  ArrowRight,
  BellRing,
  Bot,
  Check,
  Gauge,
  GitMerge,
  Layers,
  Link2,
  ListTree,
  Map as MapIcon,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Badge, LevelBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Link } from "@/i18n/routing";
import { SiteFooter } from "./SiteFooter";
import { SiteNav } from "./SiteNav";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0 },
};

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

export function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteNav />
      <main className="flex-1">
        <Hero />
        <Stats />
        <Features />
        <AutofixShowcase />
        <PricingTeaser />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}

function Hero() {
  const t = useTranslations("landing.hero");
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid opacity-60" />
      <div className="pointer-events-none absolute inset-0 -z-10 glow-accent" />

      <div className="mx-auto max-w-6xl px-4 pb-20 pt-20 text-center sm:px-6 sm:pt-28">
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="show"
          className="mx-auto max-w-3xl"
        >
          <motion.div variants={fadeUp} transition={{ duration: 0.5 }}>
            <Badge variant="accent" className="px-3 py-1 text-xs">
              <Sparkles className="h-3.5 w-3.5" />
              {t("badge")}
            </Badge>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            transition={{ duration: 0.5 }}
            className="mt-6 text-balance text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-6xl"
          >
            {t("titleLine1")} <span className="text-gradient">{t("titleLine2")}</span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            transition={{ duration: 0.5 }}
            className="mx-auto mt-6 max-w-2xl text-balance text-lg text-muted-foreground"
          >
            {t("subtitle")}
          </motion.p>

          <motion.div
            variants={fadeUp}
            transition={{ duration: 0.5 }}
            className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Link href="/register">
              <Button size="lg" className="group w-full sm:w-auto">
                {t("ctaPrimary")}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
              </Button>
            </Link>
            <Link href="/pricing">
              <Button size="lg" variant="outline" className="w-full sm:w-auto">
                {t("ctaSecondary")}
              </Button>
            </Link>
          </motion.div>
        </motion.div>

        <HeroPreview />
      </div>
    </section>
  );
}

function HeroPreview() {
  const rows = [
    {
      level: "fatal" as const,
      title: "TypeError",
      value: "Cannot read 'id' of undefined",
      seen: "1.2k",
    },
    {
      level: "error" as const,
      title: "QueryException",
      value: "SQLSTATE[42S02] table not found",
      seen: "843",
    },
    {
      level: "warning" as const,
      title: "TimeoutError",
      value: "Upstream request timed out",
      seen: "211",
    },
  ];
  const tl = useTranslations("dashboard.issues.level");
  return (
    <motion.div
      initial={{ opacity: 0, y: 40, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.6, delay: 0.25, ease: "easeOut" }}
      className="mx-auto mt-16 max-w-4xl"
    >
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card shadow-lg">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-[var(--level-fatal)]/70" />
          <span className="h-3 w-3 rounded-full bg-[var(--level-warning)]/70" />
          <span className="h-3 w-3 rounded-full bg-success/70" />
          <span className="ms-3 text-xs text-muted-foreground">errora — issues</span>
        </div>
        <div className="divide-y divide-border">
          {rows.map((r, i) => (
            <motion.div
              key={r.title}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5 + i * 0.12 }}
              className="flex items-center justify-between gap-3 px-4 py-3.5 text-start"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <LevelBadge level={r.level} label={tl(r.level)} />
                  <span className="truncate font-semibold">{r.title}</span>
                </div>
                <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{r.value}</p>
              </div>
              <span className="shrink-0 tabular-nums text-sm text-muted-foreground">{r.seen}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function Stats() {
  const t = useTranslations("landing.stats");
  const items = [
    { value: "120M+", label: t("events") },
    { value: "99.98%", label: t("uptime") },
    { value: "<50ms", label: t("latency") },
  ];
  return (
    <section className="border-y border-border bg-background-elevated">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 px-4 py-12 text-center sm:grid-cols-3 sm:px-6">
        {items.map((s) => (
          <div key={s.label}>
            <div className="text-3xl font-extrabold tracking-tight text-accent">{s.value}</div>
            <div className="mt-1 text-sm text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Features() {
  const t = useTranslations("landing.features");
  const features = [
    { key: "grouping", icon: Layers },
    { key: "performance", icon: Gauge },
    { key: "autofix", icon: Sparkles },
    { key: "integrations", icon: GitMerge },
    { key: "alerts", icon: BellRing },
    { key: "stacktrace", icon: ListTree },
    { key: "logs", icon: ScrollText },
    { key: "mcp", icon: Bot },
    { key: "sourcemaps", icon: MapIcon },
    { key: "search", icon: Search },
    { key: "issueTracking", icon: Link2 },
    { key: "retention", icon: ShieldCheck },
  ] as const;

  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
      <SectionHeading title={t("title")} subtitle={t("subtitle")} />
      <motion.div
        variants={stagger}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-80px" }}
        className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
      >
        {features.map(({ key, icon: Icon }) => (
          <motion.div
            key={key}
            variants={fadeUp}
            transition={{ duration: 0.45 }}
            className="group rounded-[var(--radius)] border border-border bg-card p-6 shadow-sm transition-all hover:-translate-y-1 hover:border-accent/40 hover:shadow-lg"
          >
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] bg-accent-soft text-accent transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
              <Icon className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-lg font-semibold tracking-tight">{t(`${key}.title`)}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`${key}.desc`)}</p>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}

function AutofixShowcase() {
  const t = useTranslations("landing.autofixSection");
  const steps = [t("step1"), t("step2"), t("step3")];
  return (
    <section className="border-y border-border bg-background-elevated">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-24 sm:px-6 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, x: -24 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <Badge variant="accent" className="px-3 py-1">
            <Bot className="h-3.5 w-3.5" />
            {t("badge")}
          </Badge>
          <h2 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">{t("title")}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{t("desc")}</p>
          <ul className="mt-7 space-y-3">
            {steps.map((step, i) => (
              <motion.li
                key={step}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="flex items-center gap-3"
              >
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
                  <Check className="h-3.5 w-3.5" />
                </span>
                <span className="font-medium">{step}</span>
              </motion.li>
            ))}
          </ul>
          <div className="mt-8">
            <Link href="/register">
              <Button>{t("cta")}</Button>
            </Link>
          </div>
        </motion.div>

        <motion.div
          dir="ltr"
          initial={{ opacity: 0, x: 24 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="rounded-[var(--radius-lg)] border border-border bg-card p-5 text-start font-mono text-sm shadow-lg"
        >
          <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            autofix · merge request
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap leading-relaxed">
            <span className="text-muted-foreground">{`@@ app/Services/User.php @@`}</span>
            {"\n"}
            <span className="text-[var(--level-error)]">{`- $user = User::find($id);`}</span>
            {"\n"}
            <span className="text-success">{`+ $user = User::findOrFail($id);`}</span>
            {"\n"}
            <span className="text-[var(--level-error)]">{`- return $user->profile->name;`}</span>
            {"\n"}
            <span className="text-success">{`+ return $user->profile?->name ?? 'guest';`}</span>
          </pre>
        </motion.div>
      </div>
    </section>
  );
}

function PricingTeaser() {
  const t = useTranslations("landing.pricingSection");
  return (
    <section className="mx-auto max-w-6xl px-4 py-24 text-center sm:px-6">
      <SectionHeading title={t("title")} subtitle={t("subtitle")} />
      <div className="mt-8">
        <Link href="/pricing">
          <Button size="lg" variant="outline">
            {t("cta")}
            <ArrowRight className="h-4 w-4 rtl:rotate-180" />
          </Button>
        </Link>
      </div>
    </section>
  );
}

function FinalCta() {
  const t = useTranslations("landing.cta");
  return (
    <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="relative overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card px-6 py-16 text-center shadow-sm"
      >
        <div className="pointer-events-none absolute inset-0 glow-accent" />
        <h2 className="relative text-3xl font-bold tracking-tight sm:text-4xl">{t("title")}</h2>
        <p className="relative mx-auto mt-3 max-w-xl text-muted-foreground">{t("subtitle")}</p>
        <div className="relative mt-8">
          <Link href="/register">
            <Button size="lg">{t("button")}</Button>
          </Link>
        </div>
      </motion.div>
    </section>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.45 }}
      className="mx-auto max-w-2xl text-center"
    >
      <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      <p className="mt-3 text-lg text-muted-foreground">{subtitle}</p>
    </motion.div>
  );
}

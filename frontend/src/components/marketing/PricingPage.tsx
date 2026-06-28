"use client";

import { Check, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Link } from "@/i18n/routing";
import { annualPrice, PLANS, type Plan } from "@/lib/pricing";
import { cn, formatToman } from "@/lib/utils";
import { PaygSlider } from "./PaygSlider";
import { SiteFooter } from "./SiteFooter";
import { SiteNav } from "./SiteNav";

type Cycle = "monthly" | "annual";

export function PricingPage() {
  const t = useTranslations("pricing");
  const [cycle, setCycle] = React.useState<Cycle>("monthly");

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteNav />
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 pb-12 pt-20 text-center sm:px-6">
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="text-4xl font-extrabold tracking-tight sm:text-5xl"
          >
            {t("title")}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.05 }}
            className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground"
          >
            {t("subtitle")}
          </motion.p>

          <CycleToggle cycle={cycle} onChange={setCycle} />
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
          <motion.div
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.08 } } }}
            className="grid gap-5 lg:grid-cols-4"
          >
            {PLANS.map((plan) => (
              <PlanCard key={plan.id} plan={plan} cycle={cycle} />
            ))}
          </motion.div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <PaygSlider />
        </section>

        <Faq />
      </main>
      <SiteFooter />
    </div>
  );
}

function CycleToggle({ cycle, onChange }: { cycle: Cycle; onChange: (c: Cycle) => void }) {
  const t = useTranslations("pricing");
  return (
    <div className="mt-8 flex items-center justify-center gap-3">
      <div className="inline-flex items-center gap-1 rounded-full border border-border bg-muted p-1">
        {(["monthly", "annual"] as const).map((c) => (
          <button
            type="button"
            key={c}
            onClick={() => onChange(c)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              cycle === c
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t(c)}
          </button>
        ))}
      </div>
      {cycle === "annual" && (
        <Badge variant="accent" className="px-2.5 py-1">
          {t("annualSave")}
        </Badge>
      )}
    </div>
  );
}

function PlanCard({ plan, cycle }: { plan: Plan; cycle: Cycle }) {
  const t = useTranslations("pricing");
  const tp = useTranslations(`pricing.plans.${plan.id}`);
  const tc = useTranslations("common");
  const locale = useLocale();

  const features = tp.raw("features") as string[];
  const isCustom = plan.monthly === null;

  const displayPrice =
    plan.monthly === 0
      ? "0"
      : isCustom
        ? null
        : cycle === "annual"
          ? formatToman(annualPrice(plan.monthly as number), locale)
          : formatToman(plan.monthly as number, locale);

  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0 } }}
      transition={{ duration: 0.45 }}
      className={cn(
        "relative flex flex-col rounded-[var(--radius-lg)] border bg-card p-6 shadow-sm",
        plan.popular ? "border-accent shadow-lg ring-1 ring-accent/30" : "border-border"
      )}
    >
      {plan.popular && (
        <div className="absolute -top-3 start-1/2 -translate-x-1/2 rtl:translate-x-1/2">
          <Badge variant="accent" className="px-3 py-1 shadow-sm">
            <Sparkles className="h-3.5 w-3.5" />
            {t("mostPopular")}
          </Badge>
        </div>
      )}

      <h3 className="text-lg font-bold tracking-tight">{tp("name")}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{tp("desc")}</p>

      <div className="mt-5 min-h-[3.5rem]">
        {isCustom ? (
          <span className="text-2xl font-extrabold tracking-tight">{t("contactSales")}</span>
        ) : (
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-extrabold tabular-nums tracking-tight">
              {displayPrice}
            </span>
            <span className="text-sm text-muted-foreground">
              {tc("toman")} {cycle === "annual" ? t("perYear") : t("perMonth")}
            </span>
          </div>
        )}
      </div>

      <div className="mt-2">
        <Link href={isCustom ? "/login" : "/register"}>
          <Button variant={plan.popular ? "primary" : "outline"} className="w-full">
            {isCustom ? t("contactSales") : t("choosePlan")}
          </Button>
        </Link>
      </div>

      <ul className="mt-6 space-y-2.5 text-sm">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <span className="text-muted-foreground">{f}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

function Faq() {
  const t = useTranslations("pricing.faq");
  const items = [
    [t("q1"), t("a1")],
    [t("q2"), t("a2")],
    [t("q3"), t("a3")],
  ];
  const [open, setOpen] = React.useState<number | null>(null);

  return (
    <section className="mx-auto max-w-3xl px-4 pb-24 sm:px-6">
      <h2 className="text-center text-2xl font-bold tracking-tight">{t("title")}</h2>
      <div className="mt-8 space-y-3">
        {items.map(([q, a], i) => {
          const isOpen = open === i;
          return (
            <div
              key={q}
              className="overflow-hidden rounded-[var(--radius)] border border-border bg-card"
            >
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-3 p-5 text-start font-medium"
              >
                {q}
                <span
                  className={cn(
                    "shrink-0 text-muted-foreground transition-transform duration-300",
                    isOpen && "rotate-45"
                  )}
                >
                  +
                </span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    key="content"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.28, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <p className="px-5 pb-5 text-sm text-muted-foreground">{a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}

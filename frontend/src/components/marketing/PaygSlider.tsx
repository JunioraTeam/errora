"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "motion/react";
import { Gauge } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PAYG, paygCost } from "@/lib/pricing";
import { formatCompact, formatNumber, formatToman } from "@/lib/utils";
import { Link } from "@/i18n/routing";

export function PaygSlider() {
  const t = useTranslations("pricing.payg");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [events, setEvents] = React.useState(PAYG.defaultEvents);

  const cost = paygCost(events);
  const pct =
    ((events - PAYG.minEvents) / (PAYG.maxEvents - PAYG.minEvents)) * 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className="relative overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card p-8 shadow-sm"
    >
      <div className="pointer-events-none absolute inset-0 glow-accent opacity-50" />
      <div className="relative grid gap-8 lg:grid-cols-2 lg:items-center">
        <div>
          <Badge variant="accent" className="px-3 py-1">
            <Gauge className="h-3.5 w-3.5" />
            {t("badge")}
          </Badge>
          <h3 className="mt-4 text-2xl font-bold tracking-tight">
            {t("title")}
          </h3>
          <p className="mt-2 text-muted-foreground">{t("desc")}</p>

          <div className="mt-8">
            <label
              htmlFor="payg-range"
              className="flex items-center justify-between text-sm"
            >
              <span className="text-muted-foreground">{t("sliderLabel")}</span>
              <span className="font-semibold tabular-nums">
                {formatNumber(events, locale)} {t("events")}
              </span>
            </label>
            <input
              id="payg-range"
              type="range"
              min={PAYG.minEvents}
              max={PAYG.maxEvents}
              step={PAYG.step}
              value={events}
              onChange={(e) => setEvents(Number(e.target.value))}
              aria-label={t("sliderLabel")}
              className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full outline-none"
              style={{
                background: `linear-gradient(to var(--slider-dir, right), var(--accent) ${pct}%, var(--muted) ${pct}%)`,
              }}
            />
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>{formatCompact(PAYG.minEvents, locale)}</span>
              <span>{formatCompact(PAYG.maxEvents, locale)}</span>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {t("ratePer", {
                price: formatToman(PAYG.pricePerThousand, locale),
              })}{" "}
              · {t("includedFree", { count: formatNumber(PAYG.freeEvents, locale) })}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center rounded-[var(--radius)] border border-border bg-background-elevated p-8 text-center">
          <span className="text-sm text-muted-foreground">{t("estimated")}</span>
          <motion.div
            key={cost}
            initial={{ opacity: 0.4, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-2 text-4xl font-extrabold tabular-nums text-accent sm:text-5xl"
          >
            {formatToman(cost, locale)}
          </motion.div>
          <span className="mt-1 text-sm text-muted-foreground">
            {tc("toman")} {tc("perMonth")}
          </span>
          <Link href="/register" className="mt-6 w-full">
            <Button className="w-full">{t("startPayg")}</Button>
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

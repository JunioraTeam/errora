"use client";

import { Heart } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Logo } from "@/components/Logo";
import { Link } from "@/i18n/routing";
import { BRAND } from "@/lib/brand";
import { localizedYear } from "@/lib/datetime";

export function SiteFooter() {
  const t = useTranslations("landing.footer");
  const locale = useLocale();
  const year = localizedYear(locale);

  const columns: Array<{ title: string; links: Array<[string, string]> }> = [
    {
      title: t("product"),
      links: [
        [t("features"), "/#features"],
        [t("pricing"), "/pricing"],
        [t("changelog"), "/#"],
      ],
    },
    {
      title: t("company"),
      links: [
        [t("about"), "/#"],
        [t("blog"), "/#"],
        [t("careers"), "/#"],
      ],
    },
    {
      title: t("resources"),
      links: [
        [t("docs"), "/#"],
        [t("status"), "/#"],
        [t("support"), "/#"],
      ],
    },
    {
      title: t("legal"),
      links: [
        [t("privacy"), "/#"],
        [t("terms"), "/#"],
      ],
    },
  ];

  return (
    <footer className="border-t border-border bg-background-elevated">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">{t("madeWith")}</p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="mb-3 text-sm font-semibold">{col.title}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {col.links.map(([label, href]) => (
                  <li key={label}>
                    <Link href={href} className="transition-colors hover:text-foreground">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row">
          <p>{t("rights", { year, brand: BRAND })}</p>
          <p className="inline-flex items-center gap-1.5">
            {t("madeWith")}
            <Heart className="h-3.5 w-3.5 text-accent" fill="currentColor" />
          </p>
        </div>
      </div>
    </footer>
  );
}

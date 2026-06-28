"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { type Locale, locales, usePathname, useRouter } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export function LocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale() as Locale;
  const t = useTranslations("locale");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = React.useTransition();

  function switchTo(next: Locale) {
    if (next === locale) return;
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  const other = locales.find((l) => l !== locale) ?? "en";

  return (
    <button
      type="button"
      aria-label={t("switch")}
      title={t("switch")}
      disabled={pending}
      onClick={() => switchTo(other as Locale)}
      data-testid="locale-switcher"
      data-current={locale}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-transparent px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50",
        className
      )}
    >
      <Languages className="h-4 w-4" />
      <span>{t(other)}</span>
    </button>
  );
}

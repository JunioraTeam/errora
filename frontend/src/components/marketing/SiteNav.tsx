"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import type * as React from "react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Link } from "@/i18n/routing";

export function SiteNav() {
  const t = useTranslations("nav");

  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl"
    >
      <div className="mx-auto grid h-16 max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center justify-self-start">
          <Logo />
        </Link>

        <nav className="hidden items-center justify-center gap-1 text-sm md:flex">
          <NavLink href="/#features">{t("features")}</NavLink>
          <NavLink href="/pricing">{t("pricing")}</NavLink>
        </nav>

        <div className="flex items-center justify-self-end gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
          {/* Always shown regardless of auth status — avoids a load-time flicker
              between login/register and dashboard. The dashboard route itself
              redirects unauthenticated visitors to the login screen. */}
          <Link href="/dashboard">
            <Button size="sm">{t("dashboard")}</Button>
          </Link>
        </div>
      </div>
    </motion.header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </Link>
  );
}

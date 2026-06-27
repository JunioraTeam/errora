"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { LogoMark } from "@/components/Logo";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  const t = useTranslations("notFound");
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <LogoMark className="h-14 w-14 text-accent" />
      <h1 className="text-3xl font-bold tracking-tight">404</h1>
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <p className="max-w-sm text-muted-foreground">{t("desc")}</p>
      <Link href="/">
        <Button className="mt-2">{t("home")}</Button>
      </Link>
    </div>
  );
}

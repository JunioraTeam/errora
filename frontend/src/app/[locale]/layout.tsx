import type { Metadata } from "next";
import { Vazirmatn } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { Providers } from "@/components/providers/Providers";
import { dirFor, type Locale, routing } from "@/i18n/routing";
import { BRAND } from "@/lib/brand";
import { SITE_URL } from "@/lib/config";

const vazirmatn = Vazirmatn({
  subsets: ["arabic", "latin"],
  variable: "--font-vazirmatn",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common" });
  const title = `${BRAND} — ${t("tagline")}`;
  const description = t("tagline");
  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: title,
      template: `%s · ${BRAND}`,
    },
    description,
    icons: { icon: "/icon.svg" },
    // The OG/Twitter image is supplied by the `opengraph-image` file convention
    // in this segment, so it's inherited by every page under it.
    openGraph: {
      type: "website",
      siteName: BRAND,
      title,
      description,
      locale,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);
  const messages = await getMessages();
  const dir = dirFor(locale as Locale);

  return (
    <html lang={locale} dir={dir} className={vazirmatn.variable} suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

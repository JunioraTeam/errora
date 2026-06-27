import * as React from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import faMessages from "../messages/fa.json";
import enMessages from "../messages/en.json";

type Locale = "fa" | "en";

const messagesByLocale: Record<Locale, Record<string, unknown>> = {
  fa: faMessages as Record<string, unknown>,
  en: enMessages as Record<string, unknown>,
};

export function renderWithIntl(
  ui: React.ReactElement,
  { locale = "fa" as Locale, ...options }: { locale?: Locale } & RenderOptions = {},
) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={messagesByLocale[locale]}
      timeZone="Asia/Tehran"
    >
      {ui}
    </NextIntlClientProvider>,
    options,
  );
}

export { faMessages, enMessages };

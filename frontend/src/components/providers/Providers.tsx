"use client";

import type * as React from "react";
import { AuthProvider } from "./AuthProvider";
import { QueryProvider } from "./QueryProvider";
import { ThemeProvider } from "./ThemeProvider";

/**
 * Client-side provider stack shared across the whole app.
 * NextIntlClientProvider is mounted in the locale layout (server component)
 * so messages are available; this stack handles theme, data, and auth.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <AuthProvider>{children}</AuthProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}

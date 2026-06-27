"use client";

import * as React from "react";
import { ThemeProvider } from "./ThemeProvider";
import { QueryProvider } from "./QueryProvider";
import { AuthProvider } from "./AuthProvider";

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

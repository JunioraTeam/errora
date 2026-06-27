import type { ReactNode } from "react";
import "./globals.css";

// The real <html>/<body> tags live in app/[locale]/layout.tsx so that the
// `lang` and `dir` attributes can depend on the active locale. This root
// layout simply passes children through (required by the App Router).
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}

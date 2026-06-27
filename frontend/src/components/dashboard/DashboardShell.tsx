"use client";

import { Menu } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/components/providers/AuthProvider";
import { OrgProvider } from "@/components/providers/OrgProvider";
import { ProjectProvider } from "@/components/providers/ProjectProvider";
import { isRtl, useRouter } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { Sidebar } from "./Sidebar";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const locale = useLocale();
  const tc = useTranslations("common");
  const offscreen = isRtl(locale) ? "100%" : "-100%";
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);

  // Persist the desktop sidebar collapsed state across navigations/reloads.
  React.useEffect(() => {
    setCollapsed(localStorage.getItem("sidebar-collapsed") === "1");
  }, []);
  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  }, []);

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Logo />
      </div>
    );
  }

  return (
    <OrgProvider>
      <ProjectProvider>
        <div className="flex min-h-dvh bg-background">
          {/* Desktop sidebar (collapsible) */}
          <aside
            className={cn(
              "sticky top-0 hidden h-dvh shrink-0 border-e border-border bg-background-elevated transition-[width] duration-200 md:block",
              collapsed ? "w-16" : "w-64"
            )}
          >
            <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
          </aside>

          {/* Mobile drawer */}
          <AnimatePresence>
            {mobileOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setMobileOpen(false)}
                  className="fixed inset-0 z-40 bg-black/50 md:hidden"
                />
                <motion.aside
                  initial={{ x: offscreen }}
                  animate={{ x: 0 }}
                  exit={{ x: offscreen }}
                  transition={{ type: "tween", duration: 0.22 }}
                  className="fixed inset-y-0 start-0 z-50 w-72 border-e border-border bg-background-elevated md:hidden"
                >
                  <Sidebar onNavigate={() => setMobileOpen(false)} />
                </motion.aside>
              </>
            )}
          </AnimatePresence>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Mobile top bar */}
            <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 backdrop-blur md:hidden">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label={tc("menu")}
                className="rounded-md p-1.5 text-foreground hover:bg-muted"
              >
                <Menu className="h-5 w-5" />
              </button>
              <Logo />
              <span className="w-8" />
            </header>

            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </div>
      </ProjectProvider>
    </OrgProvider>
  );
}

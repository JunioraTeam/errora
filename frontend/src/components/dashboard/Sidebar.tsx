"use client";

import {
  BarChart3,
  Bot,
  Bug,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings,
  Sparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/components/providers/AuthProvider";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { OrgSwitcher } from "./OrgSwitcher";

const NAV = [
  { key: "overview", href: "/dashboard", icon: LayoutDashboard, exact: true },
  { key: "projects", href: "/projects", icon: FolderKanban },
  { key: "issues", href: "/issues", icon: Bug },
  { key: "performance", href: "/performance", icon: Gauge },
  { key: "insights", href: "/insights", icon: Bot },
  { key: "logs", href: "/logs", icon: ScrollText },
  { key: "aiFixes", href: "/ai-fixes", icon: Sparkles },
  { key: "usage", href: "/usage", icon: BarChart3 },
  { key: "settings", href: "/settings", icon: Settings },
] as const;

export function Sidebar({
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const t = useTranslations("dashboard.nav");
  const pathname = usePathname();
  const { user, signOut } = useAuth();

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <div className={cn("flex h-full flex-col gap-4 p-4", collapsed && "items-center px-2")}>
      <div className={cn("flex items-center", collapsed ? "flex-col gap-2" : "justify-between")}>
        <Link href="/" className="px-1" onClick={onNavigate}>
          <Logo showText={!collapsed} />
        </Link>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            title={t(collapsed ? "expand" : "collapse")}
            aria-label={t(collapsed ? "expand" : "collapse")}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4 rtl:rotate-180" />
            ) : (
              <PanelLeftClose className="h-4 w-4 rtl:rotate-180" />
            )}
          </button>
        )}
      </div>

      {!collapsed && <OrgSwitcher />}

      <nav className={cn("flex-1 space-y-1", collapsed && "w-full")}>
        {NAV.map((item) => {
          const { key, href, icon: Icon } = item;
          const exact = "exact" in item ? item.exact : false;
          const active = isActive(href, exact);
          return (
            <Link
              key={key}
              href={href}
              onClick={onNavigate}
              title={collapsed ? t(key) : undefined}
              className={cn(
                "flex items-center rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-colors",
                collapsed ? "justify-center" : "gap-3",
                active
                  ? "bg-accent-soft text-accent"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && t(key)}
            </Link>
          );
        })}
      </nav>

      <div
        className={cn(
          "flex items-center border-t border-border pt-3",
          collapsed ? "flex-col gap-2" : "gap-2"
        )}
      >
        {!collapsed && <LocaleSwitcher className="flex-1 justify-center" />}
        <ThemeToggle />
      </div>

      <div className="w-full border-t border-border pt-3">
        <div className={cn("flex items-center", collapsed ? "flex-col gap-2" : "gap-2.5 px-1")}>
          <Link
            href="/profile"
            onClick={onNavigate}
            title={t("profile")}
            className={cn(
              "flex items-center rounded-[var(--radius-sm)] transition-colors hover:bg-muted",
              collapsed ? "p-1" : "min-w-0 flex-1 gap-2.5 p-1"
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
              {(user?.display_name ?? user?.name ?? "?").trim().charAt(0).toUpperCase()}
            </span>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user?.display_name ?? user?.name}</p>
                <p className="truncate text-xs text-muted-foreground" dir="ltr">
                  {user?.email}
                </p>
              </div>
            )}
          </Link>
          <button
            type="button"
            onClick={signOut}
            title={t("signOut")}
            aria-label={t("signOut")}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-danger"
          >
            <LogOut className="h-4 w-4 rtl:rotate-180" />
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { Search, UserPlus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const PANEL_WIDTH = 288;

type Pos = { left: number; top?: number; bottom?: number; maxHeight: number };

/**
 * Searchable member-picker dropdown for assigning an issue. The panel is
 * rendered in a portal with fixed positioning so it overlays everything (it
 * never gets clipped by — or adds height to — an overflow-hidden table). It
 * flips above the trigger when there isn't room below.
 */
export function AssignDropdown({
  orgId,
  assigned,
  saving,
  onSave,
  align = "end",
  compact = false,
}: {
  orgId?: string;
  assigned: string[];
  saving: boolean;
  onSave: (ids: string[]) => void;
  align?: "start" | "end";
  compact?: boolean;
}) {
  const t = useTranslations("dashboard.issueDetail");
  const { user } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [pos, setPos] = React.useState<Pos | null>(null);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const place = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let left = align === "end" ? rect.right - PANEL_WIDTH : rect.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - PANEL_WIDTH - margin));
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const openUp = spaceBelow < 280 && spaceAbove > spaceBelow;
    setPos({
      left,
      top: openUp ? undefined : rect.bottom + margin,
      bottom: openUp ? window.innerHeight - rect.top + margin : undefined,
      maxHeight: Math.min(360, openUp ? spaceAbove : spaceBelow),
    });
  }, [align]);

  React.useEffect(() => {
    if (!open) return;
    place();
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  const { data: members } = useQuery({
    queryKey: ["members", orgId],
    queryFn: () => api.orgs.members(orgId as string),
    enabled: open && !!orgId,
  });

  const q = search.trim().toLowerCase();
  const filtered = (members ?? []).filter(
    (m) => !q || m.user_name?.toLowerCase().includes(q) || m.user_email?.toLowerCase().includes(q)
  );

  // Toggling a member persists the new full assignee set immediately.
  function toggle(userId: string) {
    onSave(
      assigned.includes(userId) ? assigned.filter((x) => x !== userId) : [...assigned, userId]
    );
  }

  // Keyboard support for the listbox: Enter/Space toggles, Up/Down moves focus.
  function onOptionKey(e: React.KeyboardEvent<HTMLDivElement>, userId: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle(userId);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const list = e.currentTarget.closest('[role="listbox"]');
      if (!list) return;
      const items = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'));
      const i = items.indexOf(e.currentTarget);
      const next = e.key === "ArrowDown" ? i + 1 : i - 1;
      items[(next + items.length) % items.length]?.focus();
    }
  }

  return (
    <div ref={triggerRef} className="inline-flex">
      {compact ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          aria-label={t("assign")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs transition-colors hover:bg-muted",
            assigned.length > 0 ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {assigned.length > 0 ? (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground">
              {assigned.length}
            </span>
          ) : (
            <UserPlus className="h-3.5 w-3.5" />
          )}
        </button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
          <UserPlus className="h-4 w-4" />
          {assigned.length > 0 ? t("assignedTo", { count: assigned.length }) : t("assign")}
        </Button>
      )}

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && pos && (
              <motion.div
                ref={panelRef}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "fixed",
                  left: pos.left,
                  top: pos.top,
                  bottom: pos.bottom,
                  width: PANEL_WIDTH,
                  maxHeight: pos.maxHeight,
                }}
                className="z-[100] flex flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-card p-2 shadow-lg"
              >
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("assignSearch")}
                    className="h-9 w-full rounded-[var(--radius-sm)] border border-border bg-input ps-8 pe-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                  />
                </div>
                {filtered.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    {t("assignEmpty")}
                  </p>
                ) : (
                  <ul
                    className="flex-1 space-y-0.5 overflow-y-auto"
                    role="listbox"
                    aria-multiselectable
                    aria-label={t("assign")}
                  >
                    {filtered.map((m) => (
                      <li key={m.id}>
                        {/* biome-ignore lint/a11y/useKeyWithClickEvents: option uses onKeyDown for keyboard; mouse toggle is on the checkbox */}
                        <div
                          role="option"
                          aria-selected={assigned.includes(m.user)}
                          tabIndex={0}
                          onKeyDown={(e) => onOptionKey(e, m.user)}
                          className="flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-2 hover:bg-muted focus:bg-muted focus:outline-none"
                        >
                          <Checkbox
                            checked={assigned.includes(m.user)}
                            disabled={saving}
                            onCheckedChange={() => toggle(m.user)}
                            aria-label={m.user_name}
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {m.user_name}
                              {m.user === user?.id && (
                                <span className="ms-1 font-normal text-muted-foreground">
                                  {t("you")}
                                </span>
                              )}
                            </span>
                            {m.user_email && (
                              <span className="block truncate text-xs text-muted-foreground">
                                {m.user_email}
                              </span>
                            )}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}

"use client";

import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { createPortal } from "react-dom";
import {
  addMonth,
  formatDate,
  isJalaliLocale,
  isSameDay,
  monthGrid,
  toISODate,
} from "@/lib/datetime";
import { cn, localizeDigits } from "@/lib/utils";

const PANEL_WIDTH = 288; // w-72
const MARGIN = 8; // min gap from any viewport edge

/**
 * Design-system date picker. Renders a Jalali (Shamsi) calendar in the Persian
 * locale and a Gregorian calendar otherwise — same UI either way. The value is
 * always a Gregorian ISO date (YYYY-MM-DD) so callers/backend stay calendar-agnostic.
 *
 * The popover is portalled to <body> with fixed positioning and clamped into the
 * viewport (flipping above the trigger when there's no room below) so it never
 * overflows the page or adds horizontal scroll.
 */
export function DatePicker({
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
}: {
  value?: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const locale = useLocale();
  const tc = useTranslations("common");
  const selected = value ? new Date(`${value}T00:00:00`) : null;
  const [open, setOpen] = React.useState(false);
  const [cursor, setCursor] = React.useState<Date>(selected ?? new Date());
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = React.useState(false);

  const triggerRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => setMounted(true), []);

  const dir = isJalaliLocale(locale) ? "rtl" : "ltr";

  // Compute a viewport-clamped fixed position anchored to the trigger.
  const place = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const ph = panelRef.current?.offsetHeight ?? 330;

    // Align to the trigger's start edge (right edge in RTL), then clamp.
    let left = dir === "rtl" ? r.right - PANEL_WIDTH : r.left;
    left = Math.min(Math.max(MARGIN, left), vw - PANEL_WIDTH - MARGIN);

    let top = r.bottom + MARGIN;
    if (top + ph > vh - MARGIN) {
      const above = r.top - ph - MARGIN;
      top = above >= MARGIN ? above : Math.max(MARGIN, vh - ph - MARGIN);
    }
    setPos({ top, left });
  }, [dir]);

  // Position on open, and keep it pinned to the trigger on scroll/resize.
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
    const reposition = () => place();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, place]);

  // Re-place once the panel has mounted (its real height refines the flip).
  React.useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  const { cells, title, weekdays } = monthGrid(cursor, locale);
  const today = new Date();

  function pick(d: Date) {
    onChange(toISODate(d));
    setOpen(false);
  }

  return (
    <div ref={triggerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel}
        className="flex h-10 w-full items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-input px-3 text-sm text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
      >
        <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className={cn("flex-1 truncate text-start", !selected && "text-muted-foreground")}>
          {selected ? formatDate(selected, locale) : (placeholder ?? "")}
        </span>
        {selected && (
          // biome-ignore lint/a11y/useSemanticElements: a clear control can't be a nested <button> inside the trigger button
          <span
            role="button"
            tabIndex={0}
            aria-label={tc("clearDate")}
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        )}
      </button>

      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={panelRef}
                dir={dir}
                initial={{ opacity: 0, scale: 0.97, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: -4 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                style={{
                  position: "fixed",
                  top: pos?.top ?? -9999,
                  left: pos?.left ?? -9999,
                  width: PANEL_WIDTH,
                }}
                className="z-50 origin-top rounded-[var(--radius)] border border-border bg-card p-3 shadow-lg"
              >
                <div className="mb-2 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setCursor((c) => addMonth(c, -1, locale))}
                    aria-label={tc("prevMonth")}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
                  </button>
                  <span className="text-sm font-semibold">{title}</span>
                  <button
                    type="button"
                    onClick={() => setCursor((c) => addMonth(c, 1, locale))}
                    aria-label={tc("nextMonth")}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <ChevronRight className="h-4 w-4 rtl:rotate-180" />
                  </button>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
                  {weekdays.map((w) => (
                    <div key={w} className="py-1">
                      {w}
                    </div>
                  ))}
                </div>
                <div className="mt-1 grid grid-cols-7 gap-1">
                  {cells.map((cell) => {
                    const isSel = selected && isSameDay(cell.date, selected);
                    const isToday = isSameDay(cell.date, today);
                    return (
                      <button
                        key={cell.date.toISOString()}
                        type="button"
                        onClick={() => pick(cell.date)}
                        className={cn(
                          "aspect-square rounded-md text-sm transition-colors",
                          !cell.inMonth && "text-muted-foreground/40",
                          isSel ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                          isToday && !isSel && "ring-1 ring-accent/50"
                        )}
                      >
                        {localizeDigits(cell.day, locale)}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}

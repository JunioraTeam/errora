"use client";

import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Minimal animated popover: a trigger + a panel that opens on demand, closes on
 * outside-click / Escape, and animates in and out. The panel content may be a
 * render function receiving a `close` callback.
 */
export function Popover({
  trigger,
  children,
  align = "end",
  panelClassName,
}: {
  trigger: (state: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  align?: "start" | "end";
  panelClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = React.useCallback(() => setOpen(false), []);

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "absolute z-50 mt-2 min-w-44 origin-top rounded-[var(--radius)] border border-border bg-card p-1 shadow-lg",
              align === "end" ? "end-0" : "start-0",
              panelClassName
            )}
          >
            {typeof children === "function" ? children(close) : children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A single clickable row inside a Popover panel. */
export function PopoverItem({
  onClick,
  children,
  className,
  disabled,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-start text-sm transition-colors hover:bg-muted disabled:opacity-50",
        className
      )}
    >
      {children}
    </button>
  );
}

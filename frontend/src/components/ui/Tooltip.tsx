"use client";

import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const MARGIN = 8;

/**
 * Custom tooltip (not the OS-native `title`). Wraps a single element and shows
 * a floating bubble on hover/focus, portalled to <body> with fixed positioning
 * so it escapes table/overflow clipping and stays inside the viewport.
 *
 * By default it only appears when the trigger's text is actually truncated
 * (``scrollWidth > clientWidth``) — pass ``whenTruncated={false}`` to always show.
 */
export function Tooltip({
  content,
  children,
  whenTruncated = true,
  className,
}: {
  content: React.ReactNode;
  children: React.ReactElement;
  whenTruncated?: boolean;
  className?: string;
}) {
  const ref = React.useRef<HTMLElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const show = React.useCallback(() => {
    const el = ref.current;
    if (!el || content == null || content === "") return;
    if (whenTruncated && el.scrollWidth <= el.clientWidth + 1) return;
    const r = el.getBoundingClientRect();
    const left = Math.min(Math.max(MARGIN, r.left + r.width / 2), window.innerWidth - MARGIN);
    setPos({ top: r.top, left });
  }, [content, whenTruncated]);

  const hide = React.useCallback(() => setPos(null), []);

  // Close on scroll — a hovered tooltip would otherwise drift from its anchor.
  React.useEffect(() => {
    if (!pos) return;
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [pos, hide]);

  const child = React.cloneElement(children, {
    ref,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
  } as React.HTMLAttributes<HTMLElement> & { ref: React.Ref<HTMLElement> });

  return (
    <>
      {child}
      {mounted &&
        createPortal(
          <AnimatePresence>
            {pos && (
              <motion.div
                role="tooltip"
                initial={{ opacity: 0, y: 2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 2 }}
                transition={{ duration: 0.12 }}
                style={{
                  position: "fixed",
                  top: pos.top - MARGIN,
                  left: pos.left,
                  transform: "translate(-50%, -100%)",
                }}
                className={cn(
                  "pointer-events-none z-50 max-w-xs rounded-[var(--radius-sm)] border border-border",
                  "bg-card px-2.5 py-1.5 text-xs text-foreground shadow-md",
                  "whitespace-normal break-words",
                  className
                )}
              >
                {content}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}

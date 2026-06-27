"use client";

import { ChevronDown } from "lucide-react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Clamps tall content to ``collapsedHeight`` with a fade and a "Show more"
 * toggle that animates open/closed (height auto via motion). The toggle only
 * appears when the content actually overflows.
 */
export function Collapsible({
  children,
  collapsedHeight = 320,
  className,
  buttonClassName,
}: {
  children: React.ReactNode;
  collapsedHeight?: number;
  className?: string;
  buttonClassName?: string;
}) {
  const t = useTranslations("common");
  const ref = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [contentHeight, setContentHeight] = React.useState(0);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setContentHeight(el.scrollHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const overflows = contentHeight > collapsedHeight + 8;
  const collapsed = overflows && !open;

  return (
    <div className={className}>
      <motion.div
        initial={false}
        animate={{ height: collapsed ? collapsedHeight : "auto" }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="relative overflow-hidden"
      >
        <div ref={ref}>{children}</div>
        {collapsed && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />
        )}
      </motion.div>
      {overflows && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent transition-colors hover:underline",
            buttonClassName
          )}
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          {open ? t("showLess") : t("showMore")}
        </button>
      )}
    </div>
  );
}

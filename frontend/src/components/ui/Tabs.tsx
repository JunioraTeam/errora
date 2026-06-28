"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

type TabItem = {
  value: string;
  label: React.ReactNode;
};

export function Tabs({
  items,
  value,
  onValueChange,
  className,
}: {
  items: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  // Whether more content is hidden past the start/end edge (logical, RTL-aware).
  const [atStart, setAtStart] = React.useState(true);
  const [atEnd, setAtEnd] = React.useState(true);

  const update = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // scrollLeft is negative in RTL; abs() normalizes both directions.
    const left = Math.abs(el.scrollLeft);
    const max = el.scrollWidth - el.clientWidth;
    setAtStart(left <= 1);
    setAtEnd(left >= max - 1);
  }, []);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update]);

  return (
    <div className={cn("relative inline-flex max-w-full", className)}>
      <div
        ref={scrollRef}
        role="tablist"
        onScroll={update}
        className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-[var(--radius-sm)] border border-border bg-muted p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => {
          const active = item.value === value;
          return (
            <button
              type="button"
              key={item.value}
              role="tab"
              aria-selected={active}
              onClick={() => onValueChange(item.value)}
              className={cn(
                "relative shrink-0 whitespace-nowrap rounded-[calc(var(--radius-sm)-0.25rem)] px-3.5 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <ScrollHint side="start" visible={!atStart} />
      <ScrollHint side="end" visible={!atEnd} />
    </div>
  );
}

// Fade + chevron shown over an edge when more tabs are scrollable that way.
function ScrollHint({ side, visible }: { side: "start" | "end"; visible: boolean }) {
  const start = side === "start";
  const Chevron = start ? ChevronLeft : ChevronRight;
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-y-0 flex w-8 items-center rounded-[var(--radius-sm)] from-muted to-transparent transition-opacity duration-200",
        visible ? "opacity-100" : "opacity-0",
        start
          ? "start-0 justify-start bg-linear-to-r ps-1 rtl:bg-linear-to-l"
          : "end-0 justify-end bg-linear-to-l pe-1 rtl:bg-linear-to-r"
      )}
    >
      <Chevron className="h-4 w-4 text-muted-foreground rtl:rotate-180" />
    </div>
  );
}

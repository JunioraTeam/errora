"use client";

import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Design-system checkbox. A button (role="checkbox") instead of a native input
 * so it can be styled and animated consistently. Supports an indeterminate
 * (mixed) state for "select all" headers.
 */
export function Checkbox({
  checked = false,
  indeterminate = false,
  onCheckedChange,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  checked?: boolean;
  indeterminate?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const active = checked || indeterminate;
  return (
    // biome-ignore lint/a11y/useSemanticElements: an accessible button + role=checkbox is needed for custom styling/animation
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onCheckedChange?.(!checked);
      }}
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border align-middle transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-accent bg-accent text-accent-foreground"
          : "border-border bg-input hover:border-accent/60",
        className
      )}
    >
      {indeterminate ? (
        <Minus className="h-3 w-3" strokeWidth={3} />
      ) : checked ? (
        <Check className="h-3 w-3" strokeWidth={3} />
      ) : null}
    </button>
  );
}

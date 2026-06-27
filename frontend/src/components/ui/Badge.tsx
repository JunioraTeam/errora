import * as React from "react";
import { cn } from "@/lib/utils";
import type { IssueLevel, IssueStatus } from "@/lib/types";

type BadgeVariant =
  | "default"
  | "accent"
  | "success"
  | "danger"
  | "muted"
  | "outline";

const variants: Record<BadgeVariant, string> = {
  default: "bg-foreground/10 text-foreground",
  accent: "bg-accent-soft text-accent",
  success: "bg-success/15 text-success",
  danger: "bg-danger/15 text-danger",
  muted: "bg-muted text-muted-foreground",
  outline: "border border-border text-muted-foreground",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

const levelColors: Record<IssueLevel, string> = {
  fatal: "bg-[var(--level-fatal)]/15 text-[var(--level-fatal)]",
  error: "bg-[var(--level-error)]/15 text-[var(--level-error)]",
  warning: "bg-[var(--level-warning)]/15 text-[var(--level-warning)]",
  info: "bg-[var(--level-info)]/15 text-[var(--level-info)]",
  debug: "bg-[var(--level-debug)]/15 text-[var(--level-debug)]",
};

export function LevelBadge({
  level,
  label,
  className,
}: {
  level: IssueLevel;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        levelColors[level] ?? levelColors.error,
        className,
      )}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full bg-current"
      />
      {label}
    </span>
  );
}

const statusVariant: Record<IssueStatus, BadgeVariant> = {
  unresolved: "danger",
  resolved: "success",
  ignored: "muted",
  archived: "muted",
};

export function StatusBadge({
  status,
  label,
}: {
  status: IssueStatus;
  label: string;
}) {
  return <Badge variant={statusVariant[status]}>{label}</Badge>;
}

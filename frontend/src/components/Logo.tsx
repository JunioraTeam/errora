import * as React from "react";
import { BRAND } from "@/lib/brand";

/**
 * Brand logo — a geometric "error" mark: a rounded warning triangle
 * with a glitch-offset notch forming a stylized exclamation. Themeable
 * via currentColor; the accent dot uses the design-token accent color.
 */
export function LogoMark({
  className,
  title,
  ...props
}: React.SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label={title ?? BRAND}
      className={className}
      {...props}
    >
      <title>{title ?? BRAND}</title>
      {/* Warning triangle, drawn with currentColor */}
      <path
        d="M16 3.5c1.05 0 2.02.55 2.56 1.45l11.1 18.86A3 3 0 0 1 27.1 28.3H4.9a3 3 0 0 1-2.56-4.49L13.44 4.95A3 3 0 0 1 16 3.5Z"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Exclamation stem */}
      <rect
        x="14.4"
        y="11"
        width="3.2"
        height="7.4"
        rx="1.6"
        fill="currentColor"
      />
      {/* Glitch-offset accent dot */}
      <circle cx="16" cy="22.4" r="1.9" fill="var(--accent, #da7756)" />
    </svg>
  );
}

export function Logo({
  className,
  textClassName,
  showText = true,
  title,
}: {
  className?: string;
  textClassName?: string;
  showText?: boolean;
  title?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <LogoMark className="h-7 w-7 shrink-0 text-foreground" title={title} />
      {showText && (
        <span
          className={`text-lg font-bold leading-none tracking-tight text-foreground ${textClassName ?? ""}`}
        >
          {title ?? BRAND}
        </span>
      )}
    </span>
  );
}

export default Logo;

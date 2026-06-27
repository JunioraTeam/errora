import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-10 w-full rounded-[var(--radius-sm)] border border-border bg-input px-3 py-2 text-sm",
          "text-foreground placeholder:text-muted-foreground",
          "transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

// --- Phone (Iranian mobile) ----------------------------------------------- //

/** Valid Iranian mobile national number: 9 followed by 9 digits. */
export function isValidIranMobile(national: string): boolean {
  return /^9\d{9}$/.test(national);
}

/** Strip a stored E.164 value (``+989123456789``) down to the national form. */
export function toNationalMobile(stored: string | null | undefined): string {
  const digits = (stored ?? "").replace(/\D/g, "");
  if (digits.startsWith("98") && digits.length === 12) return digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) return digits.slice(1);
  return digits.slice(0, 10);
}

/**
 * Iranian mobile input: a fixed ``+98`` prefix with the national number typed
 * after it (``9123456789``). Holds only digits (max 10); the parent gets the
 * national string and can validate with {@link isValidIranMobile}.
 */
export function PhoneInput({
  id,
  value,
  onChange,
  invalid,
  className,
}: {
  id?: string;
  value: string;
  onChange: (national: string) => void;
  invalid?: boolean;
  className?: string;
}) {
  return (
    <div
      dir="ltr"
      className={cn(
        "flex h-10 w-full items-center overflow-hidden rounded-[var(--radius-sm)] border border-border bg-input",
        "transition-colors focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-ring",
        invalid && "border-danger",
        className
      )}
    >
      <span className="select-none border-e border-border px-3 text-sm text-muted-foreground">
        +98
      </span>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        dir="ltr"
        value={value}
        placeholder="9123456789"
        maxLength={10}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
        className="h-full flex-1 bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor is provided by callers (see Field)
    <label
      className={cn("mb-1.5 block text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

export function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

type SelectOption = { value: string; label: React.ReactNode; disabled?: boolean };

/**
 * Design-system select. A custom listbox (not a native `<select>`) so the
 * dropdown can animate open/close and match the theme. Drop-in for a native
 * select: pass `<option>` children + `value`/`onChange` exactly as before.
 */
export function Select({
  className,
  children,
  value,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const options: SelectOption[] = [];
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === "option") {
      const p = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
      options.push({ value: String(p.value ?? ""), label: p.children, disabled: p.disabled });
    }
  });

  const current = String(value ?? "");
  const selected = options.find((o) => o.value === current);

  const ref = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run when the menu opens
  React.useEffect(() => {
    if (!open) return;
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === current)
      )
    );
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function choose(v: string) {
    onChange?.({ target: { value: v } } as unknown as React.ChangeEvent<HTMLSelectElement>);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
      } else {
        const dir = e.key === "ArrowDown" ? 1 : -1;
        setActive((a) => (a + dir + options.length) % options.length);
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) setOpen(true);
      else if (options[active] && !options[active].disabled) choose(options[active].value);
    }
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-border bg-input px-3 text-sm text-foreground",
          "transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
      >
        <span className="truncate text-start">{selected?.label ?? ""}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -4 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="absolute z-50 mt-1 max-h-60 w-full min-w-max origin-top overflow-auto rounded-[var(--radius-sm)] border border-border bg-card p-1 shadow-lg"
          >
            {options.map((o, i) => (
              <li key={o.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === current}
                  disabled={o.disabled}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o.value)}
                  className={cn(
                    "flex w-full items-center rounded-[var(--radius-sm)] px-2.5 py-1.5 text-start text-sm transition-colors disabled:opacity-50",
                    o.value === current
                      ? "bg-accent-soft text-accent"
                      : i === active
                        ? "bg-muted"
                        : "hover:bg-muted"
                  )}
                >
                  {o.label}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

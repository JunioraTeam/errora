"use client";

import { useSearchParams } from "next/navigation";
import * as React from "react";

/**
 * Serialize/parse a single filter value to and from its URL query-string form.
 * `serialize` returns null to omit the param entirely (used so default values
 * keep the URL clean and shareable).
 */
export type Serde<T> = {
  parse: (raw: string | null) => T;
  serialize: (value: T) => string | null;
};

/**
 * `useState` for a value that is mirrored into the URL query string, so filters
 * survive reloads and can be shared via link.
 *
 * React state stays the source of truth; the URL is updated with
 * `history.replaceState` (no navigation, no scroll, decoupled from the
 * next-intl router which only takes pathname strings). The initial value is
 * read from the current URL on mount.
 */
export function useQueryState<T>(key: string, serde: Serde<T>): [T, (value: T) => void] {
  const searchParams = useSearchParams();
  // Read once on mount; the URL is thereafter written, not watched.
  const serdeRef = React.useRef(serde);
  serdeRef.current = serde;

  const [value, setValue] = React.useState<T>(() => serde.parse(searchParams.get(key)));

  const set = React.useCallback(
    (next: T) => {
      setValue(next);
      // Merge against the live URL so sibling params written by other
      // useQueryState hooks on the same page are never clobbered.
      const params = new URLSearchParams(window.location.search);
      const raw = serdeRef.current.serialize(next);
      if (raw == null || raw === "") params.delete(key);
      else params.set(key, raw);
      const qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    },
    [key]
  );

  return [value, set];
}

/** Plain string param; omitted from the URL when it equals `def`. */
export const stringParam = (def = ""): Serde<string> => ({
  parse: (raw) => raw ?? def,
  serialize: (v) => (v === def ? null : v),
});

/** One of `allowed`; falls back to `def` for missing/invalid values. */
export const enumParam = <T extends string>(allowed: readonly T[], def: T): Serde<T> => ({
  parse: (raw) => (allowed.includes(raw as T) ? (raw as T) : def),
  serialize: (v) => (v === def ? null : v),
});

/** Integer param (e.g. pagination offset); omitted when it equals `def`. */
export const numberParam = (def = 0): Serde<number> => ({
  parse: (raw) => {
    if (raw == null) return def;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : def;
  },
  serialize: (v) => (v === def ? null : String(v)),
});

/** Comma-joined multi-select; values outside `allowed` (if given) are dropped. */
export const setParam = <T extends string>(allowed?: readonly T[]): Serde<Set<T>> => ({
  parse: (raw) => {
    const items = (raw ? raw.split(",") : []).filter(
      (x) => x && (!allowed || allowed.includes(x as T))
    ) as T[];
    return new Set(items);
  },
  serialize: (v) => (v.size > 0 ? [...v].join(",") : null),
});

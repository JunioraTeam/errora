import * as React from "react";
import { type Lang, TOKEN_CLASS, tokenize } from "@/lib/highlight";
import { cn } from "@/lib/utils";

/** Inline highlighted code — renders coloured token spans, no wrapper element.
 * Memoised because tokenizing on every render of a long stack trace is wasteful. */
export const HighlightTokens = React.memo(function HighlightTokens({
  code,
  lang,
}: {
  code: string;
  lang: Lang;
}) {
  const tokens = React.useMemo(() => tokenize(code, lang), [code, lang]);
  return (
    <>
      {tokens.map((tk, i) => (
        <span key={i} className={TOKEN_CLASS[tk.type]}>
          {tk.text}
        </span>
      ))}
    </>
  );
});

/** A standalone highlighted code block (wraps long lines by default). */
export function CodeBlock({
  code,
  lang,
  className,
  wrap = true,
}: {
  code: string;
  lang: Lang;
  className?: string;
  wrap?: boolean;
}) {
  return (
    <pre
      dir="ltr"
      className={cn(
        "overflow-x-auto font-mono text-xs leading-relaxed",
        wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
        className
      )}
    >
      <code>
        <HighlightTokens code={code} lang={lang} />
      </code>
    </pre>
  );
}

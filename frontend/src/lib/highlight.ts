/**
 * Tiny dependency-free syntax highlighter. A full grammar engine (Prism/Shiki)
 * would dwarf the rest of the bundle; for our needs — stack-trace context lines,
 * SQL breadcrumbs and a JSON config snippet — a small per-language tokenizer that
 * colours strings/numbers/comments/keywords is enough and ships ~0 extra weight.
 *
 * `tokenize` returns flat `{ text, type }` tokens; the `<CodeBlock>` component
 * renders them. Unknown languages fall back to a permissive C-like grammar.
 */

export type TokenType =
  | "plain"
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "literal"
  | "property"
  | "function"
  | "punctuation";

export type Token = { text: string; type: TokenType };

export type Lang = "json" | "sql" | "javascript" | "python" | "php" | "plain";

/** Map an event/project platform to one of our supported grammars. */
export function langForPlatform(platform?: string): Lang {
  const p = (platform || "").toLowerCase();
  if (p.includes("python")) return "python";
  if (p.includes("php") || p.includes("laravel")) return "php";
  if (
    p.includes("node") ||
    p.includes("javascript") ||
    p.includes("typescript") ||
    p.includes("react") ||
    p.includes("vue") ||
    p.includes("next")
  )
    return "javascript";
  return "javascript"; // permissive C-like default
}

const KEYWORDS: Record<Lang, Set<string>> = {
  javascript: new Set([
    "const","let","var","function","return","if","else","for","while","do","switch","case",
    "break","continue","new","class","extends","super","this","typeof","instanceof","in","of",
    "try","catch","finally","throw","async","await","yield","import","from","export","default",
    "delete","void","static","get","set","public","private","protected","interface","type","enum",
  ]),
  python: new Set([
    "def","return","if","elif","else","for","while","break","continue","class","import","from",
    "as","try","except","finally","raise","with","lambda","yield","global","nonlocal","pass",
    "assert","del","in","is","not","and","or","async","await","self","print",
  ]),
  php: new Set([
    "function","return","if","else","elseif","foreach","for","while","do","switch","case","break",
    "continue","new","class","extends","implements","public","private","protected","static","const",
    "try","catch","finally","throw","use","namespace","echo","print","as","instanceof","abstract",
    "interface","trait","global","fn","match","yield",
  ]),
  sql: new Set([
    "select","from","where","insert","into","values","update","set","delete","create","table",
    "alter","drop","join","inner","left","right","outer","on","group","by","order","having","limit",
    "offset","and","or","not","null","as","distinct","count","sum","avg","min","max","between","like",
    "in","is","union","all","desc","asc","primary","key","foreign","references","index","default",
  ]),
  json: new Set([]),
  plain: new Set([]),
};

const LITERALS = new Set(["true", "false", "null", "none", "undefined", "nil", "self", "this"]);

function makeScanner(lang: Lang) {
  const lineComment = lang === "sql" ? "--" : lang === "python" || lang === "php" ? "#" : "//";
  return (code: string): Token[] => {
    const tokens: Token[] = [];
    const kw = KEYWORDS[lang];
    let i = 0;
    const n = code.length;
    const push = (text: string, type: TokenType) => tokens.push({ text, type });

    while (i < n) {
      const c = code[i];

      // Whitespace.
      if (/\s/.test(c)) {
        let j = i + 1;
        while (j < n && /\s/.test(code[j])) j++;
        push(code.slice(i, j), "plain");
        i = j;
        continue;
      }

      // Block comment.
      if (lang !== "sql" && c === "/" && code[i + 1] === "*") {
        const end = code.indexOf("*/", i + 2);
        const j = end === -1 ? n : end + 2;
        push(code.slice(i, j), "comment");
        i = j;
        continue;
      }

      // Line comment (// , # or --).
      if (code.startsWith(lineComment, i)) {
        let j = i;
        while (j < n && code[j] !== "\n") j++;
        push(code.slice(i, j), "comment");
        i = j;
        continue;
      }

      // Strings (single, double, backtick).
      if (c === '"' || c === "'" || c === "`") {
        let j = i + 1;
        while (j < n) {
          if (code[j] === "\\") {
            j += 2;
            continue;
          }
          if (code[j] === c) {
            j++;
            break;
          }
          j++;
        }
        push(code.slice(i, j), "string");
        i = j;
        continue;
      }

      // Numbers.
      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(code[i + 1] ?? ""))) {
        let j = i + 1;
        while (j < n && /[0-9a-fx_.]/i.test(code[j])) j++;
        push(code.slice(i, j), "number");
        i = j;
        continue;
      }

      // Identifiers / keywords / php-vars.
      if (/[A-Za-z_$@\\]/.test(c)) {
        let j = i + 1;
        while (j < n && /[A-Za-z0-9_$]/.test(code[j])) j++;
        const word = code.slice(i, j);
        const lower = word.toLowerCase();
        // Skip following whitespace to detect a call `(` or json key `:`.
        let k = j;
        while (k < n && /\s/.test(code[k])) k++;
        let type: TokenType = "plain";
        if (kw.has(word) || kw.has(lower)) type = "keyword";
        else if (LITERALS.has(lower)) type = "literal";
        else if (code[k] === "(") type = "function";
        else if (word.startsWith("$") || word.startsWith("@")) type = "property";
        push(word, type);
        i = j;
        continue;
      }

      // Punctuation / operators.
      if (/[{}[\]().,;:]/.test(c)) {
        push(c, "punctuation");
        i += 1;
        continue;
      }
      push(c, "plain");
      i += 1;
    }
    return tokens;
  };
}

const scanners = new Map<Lang, (code: string) => Token[]>();

export function tokenize(code: string, lang: Lang): Token[] {
  if (lang === "plain" || !code) return [{ text: code, type: "plain" }];
  let scan = scanners.get(lang);
  if (!scan) {
    scan = makeScanner(lang);
    scanners.set(lang, scan);
  }
  const tokens = scan(code);
  if (lang !== "json") return tokens;
  // JSON: a string immediately before a colon is a property key.
  for (let idx = 0; idx < tokens.length; idx++) {
    if (tokens[idx].type !== "string") continue;
    let j = idx + 1;
    while (j < tokens.length && tokens[j].text.trim() === "") j++;
    if (tokens[j]?.text === ":") tokens[idx] = { ...tokens[idx], type: "property" };
  }
  return tokens;
}

export const TOKEN_CLASS: Record<TokenType, string> = {
  plain: "text-foreground",
  comment: "italic text-muted-foreground",
  string: "text-[var(--syntax-string,var(--success))]",
  number: "text-[var(--syntax-number,var(--level-warning))]",
  keyword: "text-[var(--syntax-keyword,var(--accent))]",
  literal: "text-[var(--syntax-literal,var(--level-warning))]",
  property: "text-[var(--syntax-property,var(--accent))]",
  function: "text-[var(--syntax-function,var(--foreground))] font-medium",
  punctuation: "text-muted-foreground",
};

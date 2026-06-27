"""
Minimal, dependency-free Source Map (v3) parser.

Decodes the Base64-VLQ ``mappings`` into per-generated-line tokens and resolves a
generated (line, column) back to the original (source, line, column, name).
Source context lines come from the map's embedded ``sourcesContent``. This avoids
pulling in a native symbolicator service — a deliberate trade for low footprint.

Lines and columns here are **0-based** (the source-map convention); callers using
1-based stack-frame positions convert at the boundary.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
_B64_INV = {c: i for i, c in enumerate(_B64)}


def vlq_decode(segment: str) -> list[int]:
    """Decode a Base64-VLQ segment into a list of signed integers."""
    out: list[int] = []
    shift = 0
    acc = 0
    for ch in segment:
        digit = _B64_INV.get(ch)
        if digit is None:
            raise ValueError(f"invalid VLQ char: {ch!r}")
        cont = digit & 32
        acc += (digit & 31) << shift
        if cont:
            shift += 5
            # A valid VLQ value fits in 32 bits (≤ ~7 groups); bound the shift so
            # a hostile run of continuation digits can't build a huge bigint.
            if shift > 40:
                raise ValueError("VLQ segment too long")
        else:
            value = acc >> 1
            out.append(-value if (acc & 1) else value)
            acc = 0
            shift = 0
    return out


def vlq_encode(values: list[int]) -> str:
    """Encode signed integers as a Base64-VLQ segment (inverse of vlq_decode)."""
    out: list[str] = []
    for value in values:
        v = (-value << 1) | 1 if value < 0 else value << 1
        while True:
            digit = v & 31
            v >>= 5
            if v:
                digit |= 32
            out.append(_B64[digit])
            if not v:
                break
    return "".join(out)


@dataclass(frozen=True)
class Token:
    src: int  # index into sources
    src_line: int  # 0-based
    src_col: int  # 0-based
    name: int | None  # index into names, or None


class SourceMap:
    """Parsed source map with generated→original lookup + source context."""

    def __init__(self, raw: dict):
        self.sources: list[str] = list(raw.get("sources") or [])
        self.sources_content: list = list(raw.get("sourcesContent") or [])
        self.names: list[str] = list(raw.get("names") or [])
        self.source_root: str = raw.get("sourceRoot") or ""
        # gen_line -> sorted list of (gen_col, Token)
        self._lines: dict[int, list[tuple[int, Token]]] = {}
        self._parse_mappings(raw.get("mappings") or "")

    @classmethod
    def from_json(cls, text: str) -> SourceMap:
        data = json.loads(text)
        # "Indexed" source maps (with `sections`) aren't supported; raise so the
        # caller can skip symbolication gracefully.
        if "sections" in data and "mappings" not in data:
            raise ValueError("indexed source maps are not supported")
        return cls(data)

    def _parse_mappings(self, mappings: str) -> None:
        src = src_line = src_col = name = 0
        for gen_line, line in enumerate(mappings.split(";")):
            gen_col = 0
            row: list[tuple[int, Token]] = []
            for seg in line.split(","):
                if not seg:
                    continue
                fields = vlq_decode(seg)
                gen_col += fields[0]
                if len(fields) >= 4:
                    src += fields[1]
                    src_line += fields[2]
                    src_col += fields[3]
                    tok_name = None
                    if len(fields) >= 5:
                        name += fields[4]
                        tok_name = name
                    row.append((gen_col, Token(src, src_line, src_col, tok_name)))
            if row:
                self._lines[gen_line] = row

    def lookup(self, line: int, column: int) -> Token | None:
        """Resolve a 0-based generated (line, column) to its original Token.

        Picks the greatest mapping whose generated column is ``<= column`` on that
        line (the standard nearest-preceding-token rule)."""
        row = self._lines.get(line)
        if not row:
            return None
        lo, hi, best = 0, len(row) - 1, None
        while lo <= hi:
            mid = (lo + hi) // 2
            if row[mid][0] <= column:
                best = row[mid][1]
                lo = mid + 1
            else:
                hi = mid - 1
        # Fall back to the first token on the line if the column precedes all.
        return best if best is not None else row[0][1]

    def source_name(self, token: Token) -> str:
        name = self.sources[token.src] if 0 <= token.src < len(self.sources) else ""
        if self.source_root and name and not name.startswith(("http://", "https://", "/")):
            return f"{self.source_root.rstrip('/')}/{name}"
        return name

    def name_of(self, token: Token) -> str:
        if token.name is not None and 0 <= token.name < len(self.names):
            return self.names[token.name]
        return ""

    def source_context(self, token: Token, ctx: int = 5):
        """Return ``(pre_context, context_line, post_context)`` for the token's
        original line from ``sourcesContent``, or ``None`` if unavailable."""
        if not (0 <= token.src < len(self.sources_content)):
            return None
        content = self.sources_content[token.src]
        if not isinstance(content, str):
            return None
        lines = content.split("\n")
        i = token.src_line
        if not (0 <= i < len(lines)):
            return None
        pre = lines[max(0, i - ctx) : i]
        post = lines[i + 1 : i + 1 + ctx]
        return pre, lines[i], post

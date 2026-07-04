import { SyntaxStyle } from "@opentui/core";

/**
 * One SyntaxStyle instance per process. Scope names come from the
 * highlight queries @opentui/core ships in assets/markdown{,_inline}:
 * markup.heading.N, markup.strong, markup.italic, markup.raw, markup.link.*,
 * markup.list.*, markup.quote, punctuation.special, plus the "default" fallback.
 */
export function createTheme(): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: "#e6edf3" },
    "markup.heading.1": { fg: "#79c0ff", bold: true },
    "markup.heading.2": { fg: "#79c0ff", bold: true },
    "markup.heading.3": { fg: "#a5d6ff", bold: true },
    "markup.heading.4": { fg: "#a5d6ff", bold: true },
    "markup.heading.5": { fg: "#a5d6ff" },
    "markup.heading.6": { fg: "#a5d6ff" },
    "markup.heading": { fg: "#79c0ff", bold: true },
    "markup.strong": { fg: "#e6edf3", bold: true },
    "markup.italic": { fg: "#e6edf3", italic: true },
    "markup.strikethrough": { fg: "#8b949e", dim: true },
    "markup.raw": { fg: "#f2cc60" },
    "markup.raw.block": { fg: "#e6edf3" },
    "markup.link": { fg: "#8b949e" },
    "markup.link.url": { fg: "#58a6ff", underline: true },
    "markup.link.label": { fg: "#58a6ff" },
    "markup.list": { fg: "#ff7b72" },
    "markup.list.checked": { fg: "#3fb950" },
    "markup.list.unchecked": { fg: "#8b949e" },
    "markup.quote": { fg: "#8b949e", italic: true },
    "punctuation.special": { fg: "#8b949e" },
    comment: { fg: "#8b949e", italic: true },
    keyword: { fg: "#ff7b72" },
    string: { fg: "#a5d6ff" },
    number: { fg: "#79c0ff" },
    function: { fg: "#d2a8ff" },
    type: { fg: "#ffa657" },
    variable: { fg: "#e6edf3" },
    operator: { fg: "#ff7b72" },
    constant: { fg: "#79c0ff" },
  });
}

export const palette = {
  statusBg: "#1f2328",
  statusFg: "#8b949e",
  statusAccent: "#e6edf3",
  selectionBg: "#1c2a3a",
  warn: "#d29922",
  ok: "#3fb950",
} as const;

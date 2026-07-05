import { SyntaxStyle } from "@opentui/core";

/**
 * Notion-dark inspired palette. Design rules:
 * - Prose is monochrome; hierarchy comes from weight and brightness, not hue.
 * - Exactly two accents: blue for interactive things (links, checked boxes),
 *   red for inline code. Everything structural (markers, borders, diagram
 *   lines) is the same muted gray.
 * - Color variety is reserved for syntax highlighting inside code blocks,
 *   where it carries meaning.
 */
export const palette = {
  text: "#d4d4d2",
  bright: "#ffffff",
  soft: "#b8b8b4",
  muted: "#8a8a86",
  faint: "#6b6f76",
  accent: "#529cca",
  code: "#eb5757",
  statusBg: "#1c1c1e",
  selectionBg: "#28323d",
  ok: "#3fb950",
  warn: "#d29922",
} as const;

/** Notion-like reading measure; blocks center within the viewport at this cap. */
export const MEASURE = 88;

export function createTheme(): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: palette.text },

    // Headings: hierarchy by brightness and weight, single hue (none).
    "markup.heading.1": { fg: palette.bright, bold: true, underline: true },
    "markup.heading.2": { fg: palette.bright, bold: true },
    "markup.heading.3": { fg: "#e3e3e0", bold: true },
    "markup.heading.4": { fg: palette.soft, bold: true },
    "markup.heading.5": { fg: palette.soft, bold: true },
    "markup.heading.6": { fg: palette.soft, bold: true },
    "markup.heading": { fg: palette.bright, bold: true },

    // Inline prose styles.
    "markup.strong": { fg: palette.bright, bold: true },
    "markup.italic": { fg: palette.text, italic: true },
    "markup.strikethrough": { fg: palette.muted, dim: true },
    "markup.raw": { fg: palette.code },
    "markup.raw.block": { fg: palette.text },

    // Interactive: blue.
    "markup.link": { fg: palette.faint },
    "markup.link.url": { fg: palette.accent, underline: true },
    "markup.link.label": { fg: palette.accent },
    "markup.list.checked": { fg: palette.accent },

    // Structure: one gray.
    "markup.list": { fg: palette.faint },
    "markup.list.unchecked": { fg: palette.faint },
    "markup.quote": { fg: palette.muted, italic: true },
    "punctuation.special": { fg: palette.faint },

    // Code block tokens (GitHub dark): variety is meaningful here.
    comment: { fg: "#8a8a86", italic: true },
    keyword: { fg: "#ff7b72" },
    string: { fg: "#a5d6ff" },
    number: { fg: "#79c0ff" },
    function: { fg: "#d2a8ff" },
    type: { fg: "#ffa657" },
    variable: { fg: "#d4d4d2" },
    operator: { fg: "#ff7b72" },
    constant: { fg: "#79c0ff" },
    property: { fg: "#79c0ff" },
    punctuation: { fg: "#8a8a86" },
  });
}

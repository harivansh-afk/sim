/**
 * Mermaid flowchart -> box-drawing ASCII. Pure text transform: no OpenTUI,
 * no DOM, no deps. Deliberately a subset:
 *
 *   flowchart LR / graph LR / TD / TB (non-LR directions render as LR
 *   with a note), nodes with [] () {} labels, chains of --> edges.
 *
 * Anything else (sequenceDiagram, gantt, unparseable lines, >24 nodes)
 * returns null and the caller falls back to a highlighted code block.
 * Fallback over wrong output, always.
 */

export interface MermaidArt {
  readonly text: string;
  /** Set when the rendering took liberties (e.g. TD drawn as LR). */
  readonly note: string | null;
}

interface Node {
  readonly id: string;
  label: string;
  /** Display label after width-fitting truncation. */
  disp: string;
  layer: number;
  /** Filled during geometry. */
  x: number;
  y: number;
  w: number;
}

interface Edge {
  readonly from: string;
  readonly to: string;
  readonly label: string | null;
}

const MAX_NODES = 24;
const GAP = 6;
const TIGHT_GAP = 4;
const TIGHT_LABEL = 14;
const BOX_H = 3;
const ROW_GAP = 1;

const HEADER_RE = /^(?:flowchart|graph)\s+(LR|RL|TD|TB|BT)?\s*$/i;
const EDGE_SPLIT_RE = /\s*(?:-{2,3}>|={2,3}>|-\.+->)\s*(?:\|([^|]*)\|\s*)?/g;
const NODE_RE = /^(\w[\w.-]*)\s*(?:(\[\[|\[\(|\(\(|\(\[|\{\{|\[|\(|\{)\s*"?(.*?)"?\s*(\]\]|\)\]|\)\)|\]\)|\}\}|\]|\)|\}))?$/;

export function renderMermaid(
  source: string,
  maxWidth: number = Number.POSITIVE_INFINITY,
): MermaidArt | null {
  const lines = source
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("%%"));
  const header = lines[0] ? HEADER_RE.exec(lines[0]) : null;
  if (!header) return null;
  const direction = (header[1] ?? "TD").toUpperCase();

  const nodes = new Map<string, Node>();
  const edges: Edge[] = [];
  for (const line of lines.slice(1)) {
    if (/^(subgraph\b|end$|classDef\b|class\b|style\b|linkStyle\b|click\b)/.test(line)) continue;
    if (!parseChain(line, nodes, edges)) return null;
    if (nodes.size > MAX_NODES) return null;
  }
  if (nodes.size === 0 || edges.length === 0) return null;

  assignLayers(nodes, edges);
  // First pass at comfortable spacing; if it overflows the viewport, retry
  // tight: smaller gaps and ellipsis-truncated labels.
  let grid = layoutAndDraw(nodes, edges, GAP, Number.POSITIVE_INFINITY);
  if (grid && gridWidth(grid) > maxWidth) {
    grid = layoutAndDraw(nodes, edges, TIGHT_GAP, TIGHT_LABEL);
  }
  if (!grid) return null;

  return {
    text: grid,
    note: direction === "LR" ? null : `direction ${direction} rendered left-to-right`,
  };
}

function gridWidth(grid: string): number {
  let max = 0;
  for (const line of grid.split("\n")) max = Math.max(max, line.length);
  return max;
}

/** Parse one `A[x] --> B --> C` chain; returns false on syntax we refuse. */
function parseChain(line: string, nodes: Map<string, Node>, edges: Edge[]): boolean {
  const labels: Array<string | null> = [];
  for (const m of line.matchAll(EDGE_SPLIT_RE)) labels.push(m[1]?.trim() || null);
  const parts = line.split(EDGE_SPLIT_RE).filter((_, i) => i % 2 === 0);
  if (parts.length === 1 && labels.length === 0) {
    // standalone node declaration
    return upsertNode(parts[0] ?? "", nodes) !== null;
  }
  let prev: string | null = null;
  for (let i = 0; i < parts.length; i++) {
    const id = upsertNode(parts[i] ?? "", nodes);
    if (!id) return false;
    if (prev) edges.push({ from: prev, to: id, label: labels[i - 1] ?? null });
    prev = id;
  }
  return true;
}

function upsertNode(token: string, nodes: Map<string, Node>): string | null {
  const m = NODE_RE.exec(token.trim());
  if (!m || !m[1]) return null;
  const id = m[1];
  const label = m[3]?.trim() || undefined;
  const existing = nodes.get(id);
  if (existing) {
    if (label) existing.label = label;
  } else {
    nodes.set(id, { id, label: label ?? id, disp: label ?? id, layer: 0, x: 0, y: 0, w: 0 });
  }
  return id;
}

/** Longest-path layering; cycles collapse into the same layer (no crash). */
function assignLayers(nodes: Map<string, Node>, edges: Edge[]): void {
  for (let pass = 0; pass < nodes.size; pass++) {
    let changed = false;
    for (const e of edges) {
      const from = nodes.get(e.from);
      const to = nodes.get(e.to);
      if (from && to && to.layer < from.layer + 1) {
        to.layer = from.layer + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

// Line chars as direction bitmasks (U=1 D=2 L=4 R=8) so overlapping edge
// segments merge into tees and junctions instead of overwriting.
const CHAR_BITS = new Map<string, number>([
  ["\u2500", 12], // ─
  ["\u2502", 3], //  │
  ["\u250c", 10], // ┌
  ["\u2510", 6], //  ┐
  ["\u2514", 9], //  └
  ["\u2518", 5], //  ┘
  ["\u251c", 11], // ├
  ["\u2524", 7], //  ┤
  ["\u252c", 14], // ┬
  ["\u2534", 13], // ┴
  ["\u253c", 15], // ┼
]);
const BITS_CHAR = new Map<number, string>([...CHAR_BITS].map(([ch, bits]) => [bits, ch]));

class Canvas {
  private rows: string[][] = [];
  constructor(readonly width: number) {}

  put(x: number, y: number, ch: string): void {
    if (x < 0 || x >= this.width || y < 0) return;
    while (this.rows.length <= y) this.rows.push(new Array<string>(this.width).fill(" "));
    const row = this.rows[y];
    if (!row) return;
    const prevBits = CHAR_BITS.get(row[x] ?? " ");
    const newBits = CHAR_BITS.get(ch);
    row[x] =
      prevBits !== undefined && newBits !== undefined
        ? (BITS_CHAR.get(prevBits | newBits) ?? ch)
        : ch;
  }

  hline(x1: number, x2: number, y: number): void {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) this.put(x, y, "\u2500");
  }

  vline(y1: number, y2: number, x: number): void {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) this.put(x, y, "\u2502");
  }

  text(x: number, y: number, s: string): void {
    for (let i = 0; i < s.length; i++) this.put(x + i, y, s[i] ?? " ");
  }

  render(): string {
    return this.rows.map((r) => r.join("").replace(/ +$/, "")).join("\n");
  }
}

function layoutAndDraw(
  nodes: Map<string, Node>,
  edges: Edge[],
  gap: number,
  labelCap: number,
): string | null {
  const layers: Node[][] = [];
  for (const node of nodes.values()) {
    node.disp =
      node.label.length > labelCap ? `${node.label.slice(0, labelCap - 1)}\u2026` : node.label;
    node.w = node.disp.length + 4;
    (layers[node.layer] ??= []).push(node);
  }
  const colWidths = layers.map((col) => Math.max(...col.map((n) => n.w)));
  const colHeights = layers.map((col) => col.length * (BOX_H + ROW_GAP) - ROW_GAP);
  const height = Math.max(...colHeights);

  // A gap must fit the longest edge label routed through it.
  const gapWidths = layers.map(() => gap);
  for (const e of edges) {
    const from = nodes.get(e.from);
    const to = nodes.get(e.to);
    if (e.label && from && to && to.layer === from.layer + 1) {
      const idx = from.layer;
      gapWidths[idx] = Math.max(gapWidths[idx] ?? gap, e.label.length + 5);
    }
  }

  let x = 0;
  let lastGap = 0;
  const colRights: number[] = [];
  for (let i = 0; i < layers.length; i++) {
    const col = layers[i];
    const colW = colWidths[i];
    if (!col || colW === undefined) return null;
    let y = Math.floor((height - (colHeights[i] ?? 0)) / 2);
    for (const node of col) {
      node.x = x + Math.floor((colW - node.w) / 2);
      node.y = y;
      y += BOX_H + ROW_GAP;
    }
    colRights[i] = x + colW;
    lastGap = gapWidths[i] ?? gap;
    x += colW + lastGap;
  }
  const canvas = new Canvas(x - lastGap);

  for (const node of nodes.values()) drawBox(canvas, node);

  const gapUse = new Map<number, number>();
  for (const e of edges) {
    const from = nodes.get(e.from);
    const to = nodes.get(e.to);
    if (!from || !to || to.layer <= from.layer) continue; // drop back-edges
    drawEdge(canvas, from, to, e.label, gapUse, height, colRights);
  }
  return canvas.render();
}

function drawBox(c: Canvas, n: Node): void {
  const { x, y, w } = n;
  c.put(x, y, "\u256d");
  c.hline(x + 1, x + w - 2, y);
  c.put(x + w - 1, y, "\u256e");
  c.put(x, y + 1, "\u2502");
  c.text(x + 2, y + 1, n.disp);
  c.put(x + w - 1, y + 1, "\u2502");
  c.put(x, y + 2, "\u2570");
  c.hline(x + 1, x + w - 2, y + 2);
  c.put(x + w - 1, y + 2, "\u256f");
}

function drawEdge(
  c: Canvas,
  from: Node,
  to: Node,
  label: string | null,
  gapUse: Map<number, number>,
  height: number,
  colRights: number[],
): void {
  const sy = from.y + 1;
  const ty = to.y + 1;
  const sx = from.x + from.w; // first char right of the source box
  const tx = to.x - 1; // last char left of the target box

  // Verticals may only live in the inter-column gap, never inside a column
  // where a narrower sibling box would be pierced.
  const gapStart = colRights[from.layer] ?? sx;
  if (to.layer === from.layer + 1) {
    // Single-gap elbow: out, turn, in.
    const used = gapUse.get(from.layer) ?? 0;
    gapUse.set(from.layer, used + 1);
    const xm = Math.min(gapStart + 1 + used * 2, tx - 2);
    if (sy === ty) {
      c.hline(sx, tx - 1, sy);
    } else {
      c.hline(sx, xm - 1, sy);
      c.put(xm, sy, ty > sy ? "\u2510" : "\u2518");
      if (Math.abs(ty - sy) > 1) c.vline(Math.min(sy, ty) + 1, Math.max(sy, ty) - 1, xm);
      c.put(xm, ty, ty > sy ? "\u2514" : "\u250c");
      c.hline(xm + 1, tx - 1, ty);
    }
    c.put(tx, ty, "\u25ba");
    if (label) {
      // Above the incoming segment, clipped so it never touches a box wall.
      const maxLen = tx - xm - 1;
      if (maxLen > 0) c.text(xm + 1, (sy === ty ? sy : ty) - 1, label.slice(0, maxLen));
    }
    return;
  }

  // Multi-layer span: drop to a bus row below the diagram, travel, rise.
  const bus = height + 1 + (gapUse.get(-1) ?? 0);
  gapUse.set(-1, (gapUse.get(-1) ?? 0) + 1);
  const x1 = Math.max(sx + 1, (colRights[from.layer] ?? sx) + 1);
  const x2 = tx - 2;
  c.hline(sx, x1 - 1, sy);
  c.put(x1, sy, "\u2510");
  c.vline(sy + 1, bus - 1, x1);
  c.put(x1, bus, "\u2514");
  c.hline(x1 + 1, x2 - 1, bus);
  c.put(x2, bus, "\u2518");
  c.vline(ty + 1, bus - 1, x2);
  c.put(x2, ty, "\u250c");
  c.hline(x2 + 1, tx - 1, ty);
  c.put(tx, ty, "\u25ba");
  if (label) {
    const maxLen = x2 - x1 - 2;
    if (maxLen > 0) c.text(x1 + 2, bus - 1, label.slice(0, maxLen));
  }
}

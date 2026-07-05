/**
 * Mermaid flowchart -> ASCII, following the rendering conventions of real
 * mermaid renderers (and mermaid-ascii, the reference terminal
 * implementation):
 *
 * - 5-row boxes with padding rows; [] square, () rounded
 * - native layout in the declared direction (TD/TB, LR, and BT/RL via
 *   reversed ranks); ranks aligned by predecessor barycenter so chains
 *   run straight
 * - edges anchor INTO borders as tees, arrowheads enter any side
 * - edge labels embedded in the line
 *
 * Unsupported diagram types return null and the caller falls back to a
 * highlighted code block. Fallback over wrong output, always.
 */

export interface MermaidArt {
  readonly text: string;
  readonly note: string | null;
}

type Shape = "square" | "round";

interface Node {
  readonly id: string;
  label: string;
  disp: string;
  shape: Shape;
  layer: number;
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
const BOX_H = 5;
const GAP = 5;
const TIGHT_GAP = 3;
const TIGHT_LABEL = 14;

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
  if (direction === "BT" || direction === "RL") {
    let max = 0;
    for (const n of nodes.values()) max = Math.max(max, n.layer);
    for (const n of nodes.values()) n.layer = max - n.layer;
  }
  const vertical = direction === "TD" || direction === "TB" || direction === "BT";

  let grid = draw(nodes, edges, vertical, GAP, Number.POSITIVE_INFINITY);
  if (grid && gridWidth(grid) > maxWidth) {
    grid = draw(nodes, edges, vertical, TIGHT_GAP, TIGHT_LABEL);
  }
  if (!grid) return null;
  return { text: grid, note: null };
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
    for (const token of (parts[0] ?? "").split("&")) {
      if (upsertNode(token, nodes) === null) return false;
    }
    return true;
  }
  // Each chain segment may be an `&` group: A --> B & C fans out.
  let prev: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const group: string[] = [];
    for (const token of (parts[i] ?? "").split("&")) {
      const id = upsertNode(token, nodes);
      if (!id) return false;
      group.push(id);
    }
    for (const source of prev) {
      for (const target of group) {
        edges.push({ from: source, to: target, label: labels[i - 1] ?? null });
      }
    }
    prev = group;
  }
  return true;
}

function upsertNode(token: string, nodes: Map<string, Node>): string | null {
  const m = NODE_RE.exec(token.trim());
  if (!m || !m[1]) return null;
  const id = m[1];
  const label = m[3]?.trim() || undefined;
  const shape: Shape = m[2]?.startsWith("(") ? "round" : "square";
  const existing = nodes.get(id);
  if (existing) {
    if (label) {
      existing.label = label;
      existing.shape = shape;
    }
  } else {
    nodes.set(id, {
      id,
      label: label ?? id,
      disp: label ?? id,
      shape: label ? shape : "square",
      layer: 0,
      x: 0,
      y: 0,
      w: 0,
    });
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

/** Allocation state for edge corridors while drawing. */
interface EdgeLanes {
  side: number;
  bus: number;
  /** Elbow slots used per inter-column gap (LR), keyed by source rank. */
  gaps: Map<number, number>;
}

interface Geometry {
  ranks: Node[][];
  height: number;
  mainWidth: number;
  laneCount: number;
  /** Main-axis end of each rank (LR: column right edge; TD: rank bottom). */
  colRights: number[];
}

/**
 * Place nodes: ranks along the main axis, siblings along the cross axis,
 * cross positions pulled toward the barycenter of their predecessors so
 * chains and symmetric fans come out straight.
 */
function placeNodes(
  nodes: Map<string, Node>,
  edges: Edge[],
  vertical: boolean,
  gap: number,
  labelCap: number,
): Geometry {
  const ranks: Node[][] = [];
  for (const node of nodes.values()) {
    node.disp =
      node.label.length > labelCap ? `${node.label.slice(0, labelCap - 1)}\u2026` : node.label;
    node.w = node.disp.length + 4;
    (ranks[node.layer] ??= []).push(node);
  }
  for (let i = 0; i < ranks.length; i++) ranks[i] ??= [];

  const preds = new Map<string, Node[]>();
  const succs = new Map<string, Node[]>();
  for (const e of edges) {
    const from = nodes.get(e.from);
    const to = nodes.get(e.to);
    if (from && to && to.layer > from.layer) {
      (preds.get(to.id) ?? preds.set(to.id, []).get(to.id))?.push(from);
      (succs.get(from.id) ?? succs.set(from.id, []).get(from.id))?.push(to);
    }
  }

  // Cross-axis extent of a node: its width when vertical (TD), box height
  // when horizontal (LR).
  const extent = (n: Node) => (vertical ? n.w : BOX_H);
  const crossGap = gap;

  const sweepRank = (rank: Node[], neighbors: Map<string, Node[]>) => {
    let cursor = Number.NEGATIVE_INFINITY;
    for (const node of rank) {
      const others = neighbors.get(node.id) ?? [];
      let desired = cursor === Number.NEGATIVE_INFINITY ? 0 : cursor;
      if (others.length > 0) {
        let sum = 0;
        for (const o of others) sum += cross(o, vertical) + extent(o) / 2;
        desired = Math.round(sum / others.length - extent(node) / 2);
      } else if (cursor === Number.NEGATIVE_INFINITY) {
        desired = cross(node, vertical);
      }
      const pos = Math.max(cursor, desired);
      setCross(node, vertical, pos);
      cursor = pos + extent(node) + crossGap;
    }
  };

  // Dagre-style alternating sweeps: pull children under parents, then
  // parents over children, then settle downward once more.
  for (let r = 0; r < ranks.length; r++) sweepRank(ranks[r] ?? [], preds);
  for (let r = ranks.length - 2; r >= 0; r--) sweepRank(ranks[r] ?? [], succs);
  for (let r = 1; r < ranks.length; r++) sweepRank(ranks[r] ?? [], preds);

  let minCross = Number.POSITIVE_INFINITY;
  for (const node of nodes.values()) minCross = Math.min(minCross, cross(node, vertical));
  if (minCross === Number.POSITIVE_INFINITY) minCross = 0;

  // Main-axis positions per rank + normalize cross to start at 0. Horizontal
  // layouts widen a rank gap so inline edge labels fit on the line.
  const labelNeed: number[] = [];
  if (!vertical) {
    for (const e of edges) {
      const from = nodes.get(e.from);
      const to = nodes.get(e.to);
      if (e.label && from && to && to.layer === from.layer + 1) {
        labelNeed[from.layer] = Math.max(labelNeed[from.layer] ?? 0, e.label.length + 4);
      }
    }
  }
  let main = 0;
  const rankMain: number[] = [];
  const colRights: number[] = [];
  for (let r = 0; r < ranks.length; r++) {
    rankMain[r] = main;
    const rank = ranks[r] ?? [];
    const rankExtent = vertical ? BOX_H : Math.max(0, ...rank.map((n) => n.w));
    colRights[r] = main + rankExtent;
    main += rankExtent + (vertical ? GAP : Math.max(gap, labelNeed[r] ?? 0));
  }
  let mainWidth = 0;
  let height = 0;
  for (const node of nodes.values()) {
    const m = rankMain[node.layer] ?? 0;
    if (vertical) {
      node.x = cross(node, vertical) - minCross;
      node.y = m;
      // center box within rank main extent: rank extent is BOX_H, exact.
    } else {
      const rank = ranks[node.layer] ?? [];
      const colW = Math.max(0, ...rank.map((n) => n.w));
      node.x = m + Math.floor((colW - node.w) / 2);
      node.y = cross(node, vertical) - minCross;
    }
    mainWidth = Math.max(mainWidth, node.x + node.w);
    height = Math.max(height, node.y + BOX_H);
  }

  let laneCount = 0;
  for (const e of edges) {
    const from = nodes.get(e.from);
    const to = nodes.get(e.to);
    if (from && to && Math.abs(to.layer - from.layer) !== 1) laneCount++;
  }
  return { ranks, height, mainWidth, laneCount, colRights };
}

function cross(n: Node, vertical: boolean): number {
  return vertical ? n.x : n.y;
}

function setCross(n: Node, vertical: boolean, v: number): void {
  if (vertical) n.x = v;
  else n.y = v;
}

function draw(
  nodes: Map<string, Node>,
  edges: Edge[],
  vertical: boolean,
  gap: number,
  labelCap: number,
): string | null {
  // Horizontal layouts widen gaps that carry inline edge labels.
  const geo = placeNodes(nodes, edges, vertical, gap, labelCap);
  const width = geo.mainWidth + (vertical ? 2 + geo.laneCount * 2 : 0) + 1;
  const canvas = new Canvas(Math.max(width, geo.mainWidth + 1));

  for (const node of nodes.values()) drawBox(canvas, node);

  const lanes = { side: 0, bus: 0, gaps: new Map<number, number>() };
  for (const e of edges) {
    const from = nodes.get(e.from);
    const to = nodes.get(e.to);
    if (!from || !to || from === to) continue;
    if (vertical) drawEdgeTD(canvas, from, to, e.label, geo, lanes);
    else drawEdgeLR(canvas, from, to, e.label, geo, lanes);
  }
  return canvas.render();
}

function drawBox(c: Canvas, n: Node): void {
  const { x, y, w } = n;
  const [tl, tr, bl, br] =
    n.shape === "round"
      ? ["\u256d", "\u256e", "\u2570", "\u256f"]
      : ["\u250c", "\u2510", "\u2514", "\u2518"];
  c.put(x, y, tl);
  c.hline(x + 1, x + w - 2, y);
  c.put(x + w - 1, y, tr);
  for (const row of [1, 2, 3]) {
    c.put(x, y + row, "\u2502");
    c.put(x + w - 1, y + row, "\u2502");
  }
  c.text(x + 2, y + 2, n.disp);
  c.put(x, y + 4, bl);
  c.hline(x + 1, x + w - 2, y + 4);
  c.put(x + w - 1, y + 4, br);
}

/** Embed a label into a run of line characters, mermaid-ascii style. */
function embedLabel(c: Canvas, label: string, x: number, y: number, maxLen: number): void {
  const startX = Math.max(0, x);
  const len = Math.min(maxLen, c.width - startX);
  if (len <= 0 || y < 0) return;
  c.text(startX, y, label.length > len ? `${label.slice(0, Math.max(1, len - 1))}\u2026` : label);
}

function drawEdgeTD(
  c: Canvas,
  from: Node,
  to: Node,
  label: string | null,
  geo: Geometry,
  lanes: EdgeLanes,
): void {
  const vcx = to.x + Math.floor(to.w / 2);
  const ucy = from.y + 2;
  const uBottom = from.y + BOX_H - 1;
  const span = to.layer - from.layer;

  // Overlap of the two boxes' border interiors decides straight vs jog:
  // choosing a drop column inside BOTH borders can never draw through a box.
  const overlapLo = Math.max(from.x + 1, to.x + 1);
  const overlapHi = Math.min(from.x + from.w - 2, to.x + to.w - 2);

  if (span === 1 && overlapLo <= overlapHi) {
    const dropX = Math.max(overlapLo, Math.min(overlapHi, vcx));
    c.put(dropX, uBottom, "\u252c");
    c.vline(uBottom + 1, to.y - 2, dropX);
    c.put(dropX, to.y - 1, "\u25bc");
    if (label) embedLabel(c, label, dropX - Math.floor(label.length / 2), uBottom + 3, c.width);
    return;
  }
  if (span === 1) {
    // Disjoint columns: side exit toward the target, drop onto its top.
    // Disjointness guarantees the horizontal run is outside both boxes.
    const right = to.x > from.x;
    const exitX = right ? from.x + from.w - 1 : from.x;
    c.put(exitX, ucy, right ? "\u251c" : "\u2524");
    c.hline(right ? exitX + 1 : vcx + 1, right ? vcx - 1 : exitX - 1, ucy);
    c.put(vcx, ucy, right ? "\u2510" : "\u250c");
    c.vline(ucy + 1, to.y - 2, vcx);
    c.put(vcx, to.y - 1, "\u25bc");
    if (label) embedLabel(c, label, vcx - Math.floor(label.length / 2), Math.floor((ucy + to.y) / 2), c.width);
    return;
  }
  // Long hops and back edges share the right-side lane corridor, which is
  // outside every box by construction.
  const laneX = Math.min(c.width - 1, geo.mainWidth + 1 + lanes.side * 2);
  lanes.side++;
  const exitX = from.x + from.w - 1;
  c.put(exitX, ucy, "\u251c");
  c.hline(exitX + 1, laneX - 1, ucy);
  if (span > 1) {
    // Down the lane, enter the target's right border.
    const vcy = to.y + 2;
    c.put(laneX, ucy, "\u2510");
    c.vline(ucy + 1, vcy - 1, laneX);
    c.put(laneX, vcy, "\u2518");
    c.hline(to.x + to.w + 1, laneX - 1, vcy);
    c.put(to.x + to.w, vcy, "\u25c4");
  } else {
    // Back edge: up the lane, enter the target's right border from below.
    const vcy = to.y + 2;
    c.put(laneX, ucy, "\u2518");
    c.vline(vcy + 1, ucy - 1, laneX);
    c.put(laneX, vcy, "\u2510");
    c.hline(to.x + to.w + 1, laneX - 1, vcy);
    c.put(to.x + to.w, vcy, "\u25c4");
  }
  if (label) embedLabel(c, label, exitX + 2, ucy - 1, laneX - exitX - 3);
}

function drawEdgeLR(
  c: Canvas,
  from: Node,
  to: Node,
  label: string | null,
  geo: Geometry,
  lanes: EdgeLanes,
): void {
  const ucy = from.y + 2;
  const vcy = to.y + 2;
  const uRight = from.x + from.w - 1;
  const span = to.layer - from.layer;

  // Overlap of side-border rows decides straight vs elbow.
  const overlapLo = Math.max(from.y + 1, to.y + 1);
  const overlapHi = Math.min(from.y + BOX_H - 2, to.y + BOX_H - 2);

  if (span === 1 && overlapLo <= overlapHi) {
    const rowY = Math.max(overlapLo, Math.min(overlapHi, vcy));
    c.put(uRight, rowY, "\u251c");
    c.hline(uRight + 1, to.x - 2, rowY);
    c.put(to.x - 1, rowY, "\u25ba");
    if (label) embedLabel(c, label, uRight + 2, rowY, to.x - uRight - 4);
    return;
  }
  if (span === 1) {
    // Elbow inside the inter-column gap; verticals never enter a column.
    const gapStart = geo.colRights[from.layer] ?? uRight + 1;
    const used = lanes.gaps.get(from.layer) ?? 0;
    lanes.gaps.set(from.layer, used + 1);
    const xm = Math.max(uRight + 2, Math.min(gapStart + 1 + (used % 3) * 2, to.x - 2));
    c.put(uRight, ucy, "\u251c");
    c.hline(uRight + 1, xm - 1, ucy);
    c.put(xm, ucy, vcy > ucy ? "\u2510" : "\u2518");
    if (Math.abs(vcy - ucy) > 1) c.vline(Math.min(ucy, vcy) + 1, Math.max(ucy, vcy) - 1, xm);
    c.put(xm, vcy, vcy > ucy ? "\u2514" : "\u250c");
    c.hline(xm + 1, to.x - 2, vcy);
    c.put(to.x - 1, vcy, "\u25ba");
    if (label) embedLabel(c, label, xm + 2, vcy, to.x - xm - 4);
    return;
  }
  // Long hops and back edges travel the bus corridor below the diagram and
  // rise into the target's bottom border.
  const vcx = to.x + Math.floor(to.w / 2);
  const ucx = from.x + Math.floor(from.w / 2);
  const uBottom = from.y + BOX_H - 1;
  const busY = geo.height + 1 + lanes.bus * 2;
  lanes.bus++;
  c.put(ucx, uBottom, "\u252c");
  c.vline(uBottom + 1, busY - 1, ucx);
  c.put(ucx, busY, vcx > ucx ? "\u2514" : "\u2518");
  c.hline(Math.min(ucx, vcx) + 1, Math.max(ucx, vcx) - 1, busY);
  c.put(vcx, busY, vcx > ucx ? "\u2518" : "\u2514");
  c.vline(to.y + BOX_H + 1, busY - 1, vcx);
  c.put(vcx, to.y + BOX_H, "\u25b2");
  if (label) embedLabel(c, label, Math.min(ucx, vcx) + 2, busY - 1, Math.abs(vcx - ucx) - 3);
}

import type { Heading, ListItem, Root, RootContent } from "mdast";
import { parseMarkdown } from "./adapters.ts";
import type {
  Block,
  BlockDelta,
  BlockId,
  Document,
  EditResult,
  FormatAdapter,
  HeadingEntry,
  LinkRef,
  ParsedDocument,
  SourceSpan,
  TaskRef,
} from "./types.ts";

/**
 * FNV-1a over the block's markdown. Content addressing is what keeps block
 * identity stable across full re-parses: unchanged content -> unchanged hash.
 */
function contentHash(markdown: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < markdown.length; i++) {
    hash ^= markdown.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function nodeSpan(node: RootContent, textLength: number): SourceSpan {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    // remark-parse always emits offsets for top-level nodes; a miss means a
    // plugin dropped positions, which the splice model cannot survive.
    throw new Error("block node is missing source positions");
  }
  if (start < 0 || end > textLength || start > end) {
    throw new Error(`block span out of bounds: ${start}..${end}`);
  }
  return { start, end };
}

function indexBlocks(root: Root, text: string): Block[] {
  const blocks: Block[] = [];
  const seen = new Map<string, number>();
  for (const node of root.children) {
    const span = nodeSpan(node, text.length);
    const markdown = text.slice(span.start, span.end);
    const hash = contentHash(markdown);
    const nth = seen.get(hash) ?? 0;
    seen.set(hash, nth + 1);
    blocks.push({
      id: `${hash}.${nth}`,
      index: blocks.length,
      node,
      span,
      markdown,
    });
  }
  return blocks;
}

/** Depth-first walk collecting values from every node in a block subtree. */
function collectNodes(node: RootContent, out: RootContent[]): void {
  out.push(node);
  if ("children" in node) {
    for (const child of node.children) collectNodes(child, out);
  }
}

function plainText(node: RootContent): string {
  const nodes: RootContent[] = [];
  collectNodes(node, nodes);
  let text = "";
  for (const n of nodes) {
    if (n.type === "text" || n.type === "inlineCode") text += n.value;
  }
  return text;
}

const CHECKBOX_PATTERN = /\[( |x|X)\]/;

function taskRefFor(item: ListItem, block: Block, text: string): TaskRef | null {
  if (item.checked === null || item.checked === undefined) return null;
  const start = item.position?.start.offset;
  const end = item.position?.end.offset;
  if (start === undefined || end === undefined) return null;
  const firstLine = text.slice(start, end).split("\n", 1)[0] ?? "";
  if (!CHECKBOX_PATTERN.test(firstLine)) return null;
  return {
    blockId: block.id,
    span: { start, end },
    checked: item.checked,
    label: firstLine.replace(/^[-*+]\s*\[( |x|X)\]\s*/, "").trim(),
  };
}

class DocumentSnapshot implements Document {
  readonly text: string;
  readonly writeback: boolean;
  readonly blocks: readonly Block[];
  readonly formatName: string;
  private readonly byId: Map<BlockId, Block>;

  constructor(parsed: ParsedDocument, formatName: string) {
    this.text = parsed.text;
    this.writeback = parsed.writeback;
    this.formatName = formatName;
    this.blocks = indexBlocks(parsed.root, parsed.text);
    this.byId = new Map(this.blocks.map((b) => [b.id, b]));
  }

  block(id: BlockId): Block | undefined {
    return this.byId.get(id);
  }

  outline(): readonly HeadingEntry[] {
    const entries: HeadingEntry[] = [];
    for (const block of this.blocks) {
      if (block.node.type !== "heading") continue;
      const heading = block.node as Heading;
      entries.push({
        blockId: block.id,
        depth: heading.depth,
        text: plainText(block.node),
      });
    }
    return entries;
  }

  tasks(): readonly TaskRef[] {
    const refs: TaskRef[] = [];
    for (const block of this.blocks) {
      const nodes: RootContent[] = [];
      collectNodes(block.node, nodes);
      for (const node of nodes) {
        if (node.type !== "listItem") continue;
        const ref = taskRefFor(node, block, this.text);
        if (ref) refs.push(ref);
      }
    }
    return refs;
  }

  links(): readonly LinkRef[] {
    const refs: LinkRef[] = [];
    for (const block of this.blocks) {
      const nodes: RootContent[] = [];
      collectNodes(block.node, nodes);
      for (const node of nodes) {
        if (node.type === "link") {
          refs.push({ blockId: block.id, url: node.url, text: plainText(node) });
        }
      }
    }
    return refs;
  }

  replaceBlock(id: BlockId, markdown: string): EditResult {
    const block = this.byId.get(id);
    if (!block) throw new Error(`unknown block: ${id}`);
    return this.splice(block.span, markdown);
  }

  toggleTask(ref: TaskRef): EditResult {
    // Flip only the checkbox marker on the item's first line. Everything
    // else in the file is untouched by construction.
    const firstLineEnd = this.text.indexOf("\n", ref.span.start);
    const lineEnd = firstLineEnd === -1 ? ref.span.end : Math.min(firstLineEnd, ref.span.end);
    const line = this.text.slice(ref.span.start, lineEnd);
    const match = CHECKBOX_PATTERN.exec(line);
    if (!match || match.index === undefined) {
      throw new Error("task item has no checkbox marker on its first line");
    }
    const markerStart = ref.span.start + match.index;
    const replacement = ref.checked ? "[ ]" : "[x]";
    return this.splice({ start: markerStart, end: markerStart + 3 }, replacement);
  }

  /**
   * The write-back core: replace exactly [start, end) in the source text,
   * re-parse the whole document, and diff block ids. Full re-parse (instead
   * of incremental position surgery) is what keeps positions trustworthy;
   * at file scale it is microseconds, not a bottleneck.
   */
  private splice(span: SourceSpan, replacement: string): EditResult {
    if (!this.writeback) {
      throw new Error(`${this.formatName} documents are read-only`);
    }
    const nextText =
      this.text.slice(0, span.start) + replacement + this.text.slice(span.end);
    const next = new DocumentSnapshot(
      { root: parseMarkdown(nextText), text: nextText, writeback: true },
      this.formatName,
    );
    return { next, delta: diffBlocks(this.blocks, next.blocks) };
  }
}

function diffBlocks(prev: readonly Block[], next: readonly Block[]): BlockDelta {
  const replaced: Array<{ oldId: BlockId; newId: BlockId }> = [];
  const structural = prev.length !== next.length;
  const pairs = Math.min(prev.length, next.length);
  for (let i = 0; i < pairs; i++) {
    const before = prev[i];
    const after = next[i];
    if (before && after && before.id !== after.id) {
      replaced.push({ oldId: before.id, newId: after.id });
    }
  }
  return { replaced, structural };
}

/** Entry point: parse file text with the given adapter into a snapshot. */
export function openDocument(fileText: string, adapter: FormatAdapter): Document {
  return new DocumentSnapshot(adapter.parse(fileText), adapter.name);
}

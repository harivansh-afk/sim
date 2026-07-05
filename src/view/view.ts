import {
  MarkdownRenderable,
  Renderable,
  ScrollBoxRenderable,
  StyledText,
  TextRenderable,
  bold,
  fg,
  getTreeSitterClient,
  type CliRenderer,
  type SyntaxStyle,
  type TextChunk,
} from "@opentui/core";
import type { Block, BlockDelta, BlockId, Document } from "../document/types.ts";
import { renderMermaid } from "./mermaid.ts";
import { palette } from "./theme.ts";

/**
 * Owns the scrollable rendering of one Document.
 *
 * Renderable economy is the point: consecutive ordinary blocks coalesce into
 * ONE MarkdownRenderable (one marked parse, one tree-sitter session, one yoga
 * subtree per run), because only interactive blocks need identity. Special
 * blocks - task lists (selection + toggle) and mermaid diagrams (custom
 * drawing) - get their own keyed renderables. Viewport culling keeps
 * off-screen rows out of the paint path while scrolling.
 */
export class DocumentView {
  readonly scroll: ScrollBoxRenderable;
  private readonly ctx: CliRenderer;
  private readonly syntaxStyle: SyntaxStyle;
  /** All mounted rows, in order, for teardown. */
  private mounted: Renderable[] = [];
  /** Interactive rows only, keyed by block id (tasks, diagrams). */
  private byBlock = new Map<BlockId, MarkdownRenderable | TextRenderable>();
  private highlighted: BlockId | null = null;

  constructor(ctx: CliRenderer, syntaxStyle: SyntaxStyle) {
    this.ctx = ctx;
    this.syntaxStyle = syntaxStyle;
    this.scroll = new ScrollBoxRenderable(ctx, {
      flexGrow: 1,
      width: "100%",
      scrollY: true,
      scrollX: false,
      paddingX: 2,
      viewportCulling: true,
    });
  }

  mount(doc: Document): void {
    for (const row of this.mounted) {
      this.scroll.remove(row);
      row.destroy();
    }
    this.mounted = [];
    this.byBlock.clear();
    this.highlighted = null;

    const taskBlocks = new Set<BlockId>();
    for (const task of doc.tasks()) taskBlocks.add(task.blockId);
    const h1Text = new Map<BlockId, string>();
    for (const h of doc.outline()) {
      if (h.depth === 1) h1Text.set(h.blockId, h.text);
    }

    let runStart: Block | null = null;
    let runEnd: Block | null = null;
    const flushRun = () => {
      if (!runStart || !runEnd) return;
      this.addRow(
        this.markdownRow(`run-${runStart.id}`, doc.text.slice(runStart.span.start, runEnd.span.end)),
      );
      runStart = null;
      runEnd = null;
    };

    for (const block of doc.blocks) {
      const mermaid = block.node.type === "code" && block.node.lang === "mermaid";
      const interactive = taskBlocks.has(block.id);
      const bigHeading = h1Text.get(block.id);
      if (!mermaid && !interactive && bigHeading === undefined) {
        runStart ??= block;
        runEnd = block;
        continue;
      }
      flushRun();
      if (bigHeading !== undefined) {
        // Terminals have no font sizes; h1 gets weight + a heavy anchor rule.
        this.addRow(
          new TextRenderable(this.ctx, {
            id: `blk-${block.id}`,
            content: new StyledText([
              bold(fg(palette.bright)(bigHeading)),
              fg(palette.faint)(`\n${"\u2501".repeat(Math.max(4, bigHeading.length + 1))}`),
            ]),
            wrapMode: "word",
            width: "100%",
            marginBottom: 1,
          }),
        );
        continue;
      }
      if (mermaid && block.node.type === "code") {
        const art = renderMermaid(block.node.value, Math.max(40, this.ctx.terminalWidth - 6));
        if (art) {
          const row = new TextRenderable(this.ctx, {
            id: `blk-${block.id}`,
            content: diagramStyled(art.text),
            wrapMode: "none",
            width: "auto",
            alignSelf: "center",
            marginY: 1,
          });
          this.byBlock.set(block.id, row);
          this.addRow(row);
          continue;
        }
        // Unsupported mermaid: render as the highlighted code block it is.
      }
      const row = this.markdownRow(`blk-${block.id}`, block.markdown);
      this.byBlock.set(block.id, row);
      this.addRow(row);
    }
    flushRun();
  }

  /**
   * Reconcile after an edit. Task toggles hit interactive rows and swap
   * content surgically; anything else (or a structural change) remounts.
   */
  applyEdit(next: Document, delta: BlockDelta): void {
    if (delta.structural) {
      this.mount(next);
      return;
    }
    for (const { oldId, newId } of delta.replaced) {
      const row = this.byBlock.get(oldId);
      const block = next.block(newId);
      if (!row || !block || !(row instanceof MarkdownRenderable)) {
        this.mount(next);
        return;
      }
      row.content = block.markdown;
      this.byBlock.delete(oldId);
      this.byBlock.set(newId, row);
      if (this.highlighted === oldId) this.highlighted = newId;
    }
  }

  /** Move the selection highlight to an interactive block (null clears). */
  highlight(id: BlockId | null): void {
    if (this.highlighted && this.highlighted !== id) {
      const prev = this.byBlock.get(this.highlighted);
      if (prev) prev.bg = undefined;
    }
    this.highlighted = id;
    if (id) {
      const row = this.byBlock.get(id);
      if (row) {
        row.bg = palette.selectionBg;
        this.scroll.scrollChildIntoView(row.id);
      }
    }
  }

  scrollLines(lines: number): void {
    this.scroll.scrollBy(lines);
  }

  scrollPage(direction: 1 | -1): void {
    const viewport = Math.max(1, this.scroll.viewport.height - 2);
    this.scroll.scrollBy(direction * viewport);
  }

  scrollToTop(): void {
    this.scroll.scrollTo(0);
  }

  scrollToBottom(): void {
    this.scroll.scrollTo(this.scroll.scrollHeight);
  }

  /** 0..100 for the status bar. */
  scrollPercent(): number {
    // Before the first layout pass scrollHeight is 0; report top, not end.
    if (this.scroll.scrollHeight === 0) return 0;
    const max = this.scroll.scrollHeight - this.scroll.viewport.height;
    if (max <= 0) return 100;
    return Math.min(100, Math.round((this.scroll.scrollTop / max) * 100));
  }

  private addRow(row: Renderable): void {
    this.mounted.push(row);
    this.scroll.add(row);
  }

  private markdownRow(id: string, content: string): MarkdownRenderable {
    return new MarkdownRenderable(this.ctx, {
      id,
      content,
      syntaxStyle: this.syntaxStyle,
      treeSitterClient: getTreeSitterClient(),
      conceal: true,
      width: "100%",
      marginBottom: 1,
    });
  }
}


const STRUCTURE_CHARS = new Set(
  "\u2500\u2502\u256d\u256e\u2570\u256f\u250c\u2510\u2514\u2518\u251c\u2524\u252c\u2534\u253c\u25ba\u25c4\u25b2\u25bc",
);

/** Two-tone diagram: structure in muted gray, labels in body color. */
function diagramStyled(body: string): StyledText {
  const chunks: TextChunk[] = [];
  let run = "";
  let runIsStructure = false;
  const flush = () => {
    if (run.length > 0) chunks.push(fg(runIsStructure ? palette.faint : palette.text)(run));
    run = "";
  };
  for (const ch of body) {
    const isStructure = STRUCTURE_CHARS.has(ch);
    if (run.length > 0 && isStructure !== runIsStructure && ch !== " " && run.trim().length > 0) {
      flush();
    }
    if (run.length === 0) runIsStructure = isStructure;
    run += ch;
  }
  flush();
  return new StyledText(chunks);
}

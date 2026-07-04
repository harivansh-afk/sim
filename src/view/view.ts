import {
  MarkdownRenderable,
  ScrollBoxRenderable,
  getTreeSitterClient,
  type RenderContext,
  type SyntaxStyle,
} from "@opentui/core";
import type { Block, BlockDelta, BlockId, Document } from "../document/types.ts";
import { palette } from "./theme.ts";

/**
 * Owns the scrollable rendering of one Document: one MarkdownRenderable per
 * top-level block, keyed by block id. Hides reconciliation (surgical content
 * swaps for in-place edits, full rebuild for structural changes), selection
 * highlight, and scroll bookkeeping. Never touches disk or mdast internals.
 */
export class DocumentView {
  readonly scroll: ScrollBoxRenderable;
  private readonly ctx: RenderContext;
  private readonly syntaxStyle: SyntaxStyle;
  private rows = new Map<BlockId, MarkdownRenderable>();
  private highlighted: BlockId | null = null;

  constructor(ctx: RenderContext, syntaxStyle: SyntaxStyle) {
    this.ctx = ctx;
    this.syntaxStyle = syntaxStyle;
    this.scroll = new ScrollBoxRenderable(ctx, {
      flexGrow: 1,
      width: "100%",
      scrollY: true,
      scrollX: false,
      paddingX: 1,
    });
  }

  mount(doc: Document): void {
    for (const row of this.rows.values()) {
      this.scroll.remove(row);
      row.destroy();
    }
    this.rows.clear();
    this.highlighted = null;
    for (const block of doc.blocks) this.scroll.add(this.buildRow(block));
  }

  /**
   * Reconcile after an edit. Deltas with unchanged block count map old ids to
   * new ids in place; structural deltas fall back to a full rebuild (correct
   * first, clever later).
   */
  applyEdit(next: Document, delta: BlockDelta): void {
    if (delta.structural) {
      this.mount(next);
      return;
    }
    for (const { oldId, newId } of delta.replaced) {
      const row = this.rows.get(oldId);
      const block = next.block(newId);
      if (!row || !block) {
        this.mount(next);
        return;
      }
      row.content = block.markdown;
      this.rows.delete(oldId);
      this.rows.set(newId, row);
      if (this.highlighted === oldId) this.highlighted = newId;
    }
  }

  /** Move the selection highlight to a block (or clear it with null). */
  highlight(id: BlockId | null): void {
    if (this.highlighted && this.highlighted !== id) {
      const prev = this.rows.get(this.highlighted);
      if (prev) prev.bg = undefined;
    }
    this.highlighted = id;
    if (id) {
      const row = this.rows.get(id);
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

  private buildRow(block: Block): MarkdownRenderable {
    const row = new MarkdownRenderable(this.ctx, {
      id: `blk-${block.id}`,
      content: block.markdown,
      syntaxStyle: this.syntaxStyle,
      treeSitterClient: getTreeSitterClient(),
      conceal: true,
      width: "100%",
      marginBottom: 1,
    });
    this.rows.set(block.id, row);
    return row;
  }
}

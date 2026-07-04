import type { Root, RootContent } from "mdast";

/**
 * Stable identity of a top-level block. Content-hash of the block's markdown
 * plus an occurrence ordinal, so unchanged blocks keep their id across
 * re-parses and duplicate blocks stay distinct.
 */
export type BlockId = string;

/** Half-open range of JS string offsets into the document's markdown text. */
export interface SourceSpan {
  readonly start: number;
  readonly end: number;
}

export interface Block {
  readonly id: BlockId;
  /** Position among the document's top-level blocks. */
  readonly index: number;
  /** The mdast node backing this block. */
  readonly node: RootContent;
  /** Span into Document.text. Always present: text is the canonical source. */
  readonly span: SourceSpan;
  /** The block's markdown, exactly text.slice(span.start, span.end). */
  readonly markdown: string;
}

/** A checkbox task item, addressable for toggling. */
export interface TaskRef {
  readonly blockId: BlockId;
  /** Span of the listItem node that carries the checkbox. */
  readonly span: SourceSpan;
  readonly checked: boolean;
  /** First-line text of the item, for status display. */
  readonly label: string;
}

export interface HeadingEntry {
  readonly blockId: BlockId;
  readonly depth: 1 | 2 | 3 | 4 | 5 | 6;
  readonly text: string;
}

export interface LinkRef {
  readonly blockId: BlockId;
  readonly url: string;
  readonly text: string;
}

/** What a parse produced: canonical markdown text plus its tree. */
export interface ParsedDocument {
  readonly root: Root;
  /**
   * Canonical markdown source. For markdown files this IS the file text,
   * byte-identical. For converted formats (html) it is generated text and
   * writeback must be false.
   */
  readonly text: string;
  /** True only when text === file content and edits may be written back. */
  readonly writeback: boolean;
}

export interface FormatAdapter {
  readonly name: string;
  /** Confidence 0..1 that this adapter handles the file. */
  probe(path: string, head: string): number;
  parse(fileText: string): ParsedDocument;
}

/** Result of a document mutation: the next snapshot plus what changed. */
export interface EditResult {
  readonly next: Document;
  readonly delta: BlockDelta;
}

/**
 * Minimal delta contract between store and view: which block ids were
 * replaced (old -> new) and whether anything structural (count/order) moved.
 */
export interface BlockDelta {
  readonly replaced: ReadonlyArray<{ oldId: BlockId; newId: BlockId }>;
  readonly structural: boolean;
}

/** Immutable document snapshot. Constructed by DocumentStore. */
export interface Document {
  readonly text: string;
  readonly writeback: boolean;
  readonly blocks: readonly Block[];
  readonly formatName: string;
  block(id: BlockId): Block | undefined;
  outline(): readonly HeadingEntry[];
  tasks(): readonly TaskRef[];
  links(): readonly LinkRef[];
  /** Replace one block's markdown; splice + re-parse. Throws if !writeback. */
  replaceBlock(id: BlockId, markdown: string): EditResult;
  /** Flip one checkbox; splice + re-parse. Throws if !writeback. */
  toggleTask(ref: TaskRef): EditResult;
}

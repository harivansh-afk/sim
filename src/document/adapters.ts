import rehypeParse from "rehype-parse";
import rehypeRemark from "rehype-remark";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import type { Root } from "mdast";
import type { FormatAdapter, ParsedDocument } from "./types.ts";

const mdProcessor = unified().use(remarkParse).use(remarkGfm);

/** Parse markdown text into mdast. Never mutates or reformats the source. */
export function parseMarkdown(text: string): Root {
  return mdProcessor.parse(text);
}

export const markdownAdapter: FormatAdapter = {
  name: "markdown",
  probe(path, _head) {
    return /\.(md|markdown|mdown|mkd)$/i.test(path) ? 1 : 0;
  },
  parse(fileText): ParsedDocument {
    return { root: parseMarkdown(fileText), text: fileText, writeback: true };
  },
};

const htmlToMd = unified()
  .use(rehypeParse)
  .use(rehypeRemark)
  .use(remarkGfm)
  .use(remarkStringify, { bullet: "-", fence: "`", rule: "-" });

export const htmlAdapter: FormatAdapter = {
  name: "html",
  probe(path, head) {
    if (/\.(html?|xhtml)$/i.test(path)) return 1;
    return /^\s*(<!doctype html|<html)/i.test(head) ? 0.8 : 0;
  },
  parse(fileText): ParsedDocument {
    // Convert once to markdown text, then treat that text as the canonical
    // source so spans/blocks work identically to native markdown. Lossy and
    // one-way by design: writeback stays false, serialize does not exist.
    const markdown = String(htmlToMd.processSync(fileText));
    return { root: parseMarkdown(markdown), text: markdown, writeback: false };
  },
};

const registry: FormatAdapter[] = [markdownAdapter, htmlAdapter];

/** Pick the adapter with the highest probe confidence; markdown on ties/none. */
export function resolveAdapter(path: string, head: string): FormatAdapter {
  let best = markdownAdapter;
  let bestScore = 0;
  for (const adapter of registry) {
    const score = adapter.probe(path, head);
    if (score > bestScore) {
      best = adapter;
      bestScore = score;
    }
  }
  return best;
}

/** Extension point: future formats (typst) register here. */
export function registerAdapter(adapter: FormatAdapter): void {
  registry.push(adapter);
}

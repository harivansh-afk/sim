import { describe, expect, test } from "bun:test";
import { htmlAdapter, markdownAdapter, resolveAdapter } from "../src/document/adapters.ts";
import { openDocument } from "../src/document/store.ts";
import type { Block, BlockDelta, Document, TaskRef } from "../src/document/types.ts";

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

function blockIds(document: Document): string[] {
  const ids: string[] = [];
  for (const block of document.blocks) {
    ids.push(block.id);
  }
  return ids;
}

function taskLabels(tasks: readonly TaskRef[]): string[] {
  const labels: string[] = [];
  for (const task of tasks) {
    labels.push(task.label);
  }
  return labels;
}

function taskChecked(tasks: readonly TaskRef[]): boolean[] {
  const checked: boolean[] = [];
  for (const task of tasks) {
    checked.push(task.checked);
  }
  return checked;
}

function markerStart(text: string, task: TaskRef): number {
  const lineEndIndex = text.indexOf("\n", task.span.start);
  const lineEnd = lineEndIndex === -1 ? task.span.end : Math.min(lineEndIndex, task.span.end);
  const line = text.slice(task.span.start, lineEnd);
  const match = /\[( |x|X)\]/.exec(line);
  if (match === null || match.index === undefined) {
    throw new Error(`task marker missing for ${task.label}`);
  }
  return task.span.start + match.index;
}

function expectOnlyMarkerChanged(before: string, after: string, start: number, oldMarker: string, newMarker: string): void {
  expect(before.slice(start, start + 3)).toBe(oldMarker);
  expect(after.slice(start, start + 3)).toBe(newMarker);
  expect(after.slice(0, start)).toBe(before.slice(0, start));
  expect(after.slice(start + 3)).toBe(before.slice(start + 3));
}

function replacedIds(delta: BlockDelta): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const pair of delta.replaced) {
    pairs.push([pair.oldId, pair.newId]);
  }
  return pairs;
}

describe("document markdown mutations", () => {
  test("replacing any parsed block with its own markdown preserves the original bytes", () => {
    const corpus = [
      {
        name: "headings and odd spacing",
        markdown: "# Title\n\nParagraph   with   odd spacing.\n\n## Child\n",
      },
      {
        name: "gfm table",
        markdown: "| Name | Value |\n| --- | ---: |\n| alpha | 1 |\n| beta | 20 |\n",
      },
      {
        name: "task list with trailing whitespace",
        markdown: "- [ ] todo item   \n- [x] done item\t\n- plain item  \n",
      },
      {
        name: "fenced code with internal blank lines",
        markdown: "```ts\nconst one = 1;\n\nconst two = 2;\n```\n\nAfter fence.\n",
      },
      {
        name: "nested lists and links",
        markdown: "- parent\n  - child with [site](https://example.test/path?q=1)\n    - grandchild\n\nParagraph after.\n",
      },
      {
        name: "setext headings",
        markdown: "Main title\n==========\n\nSub title\n---------\n\nText.\n",
      },
      {
        name: "html blocks in markdown",
        markdown: "<section>\n  <p>raw html</p>\n</section>\n\nMarkdown paragraph.\n",
      },
      {
        name: "extension-free plain markdown spacing",
        markdown: "Leading text\n\n   indented-looking paragraph\n\n> quote\n>\n> spaced\n",
      },
    ];

    for (const entry of corpus) {
      expect(entry.markdown.includes("\r"), entry.name).toBe(false);
      const document = openDocument(entry.markdown, markdownAdapter);
      expect(document.blocks.length, entry.name).toBeGreaterThan(0);

      for (const block of document.blocks) {
        const result = document.replaceBlock(block.id, block.markdown);
        expect(result.next.text, `${entry.name}: block ${block.index}`).toBe(entry.markdown);
      }
    }
  });

  test("toggleTask changes only the checkbox marker and preserves canonical markers across a double toggle", () => {
    const cases = [
      {
        name: "unchecked",
        markdown: "- [ ] write tests   \n",
        oldMarker: "[ ]",
        firstMarker: "[x]",
        doubleToggleText: "- [ ] write tests   \n",
      },
      {
        name: "checked lowercase",
        markdown: "- [x] already done\n",
        oldMarker: "[x]",
        firstMarker: "[ ]",
        doubleToggleText: "- [x] already done\n",
      },
      {
        name: "checked uppercase",
        markdown: "- [X] uppercase marker\n",
        oldMarker: "[X]",
        firstMarker: "[ ]",
        doubleToggleText: "- [x] uppercase marker\n",
      },
    ];

    for (const entry of cases) {
      const document = openDocument(entry.markdown, markdownAdapter);
      const task = requireValue(document.tasks()[0], `${entry.name} task`);
      const start = markerStart(document.text, task);

      const first = document.toggleTask(task);
      expectOnlyMarkerChanged(document.text, first.next.text, start, entry.oldMarker, entry.firstMarker);

      const toggledTask = requireValue(first.next.tasks()[0], `${entry.name} toggled task`);
      const second = first.next.toggleTask(toggledTask);
      expect(second.next.text, entry.name).toBe(entry.doubleToggleText);
    }
  });

  test("editing one top-level block preserves every other block id and reports a non-structural replacement", () => {
    const document = openDocument("# Title\n\nOriginal paragraph.\n\n- [ ] task\n", markdownAdapter);
    const beforeIds = blockIds(document);
    const edited = requireValue(document.blocks[1], "paragraph block");

    const result = document.replaceBlock(edited.id, "Edited paragraph.");
    const afterIds = blockIds(result.next);

    expect(result.delta.structural).toBe(false);
    expect(replacedIds(result.delta)).toEqual([[edited.id, requireValue(result.next.blocks[1], "edited next block").id]]);
    expect(afterIds.length).toBe(beforeIds.length);

    for (let index = 0; index < beforeIds.length; index += 1) {
      if (index === edited.index) {
        expect(afterIds[index]).not.toBe(beforeIds[index]);
      } else {
        expect(afterIds[index]).toBe(beforeIds[index]);
      }
    }
  });

  test("duplicate top-level blocks receive distinct stable ids", () => {
    const document = openDocument("Same paragraph.\n\nSame paragraph.\n", markdownAdapter);
    const first = requireValue(document.blocks[0], "first duplicate block");
    const second = requireValue(document.blocks[1], "second duplicate block");

    expect(first.markdown).toBe(second.markdown);
    expect(first.id).not.toBe(second.id);
  });

  test("tasks() returns only checkbox list items, including nested tasks, with labels and checked flags", () => {
    const document = openDocument(
      "- [ ] top task\n- plain item\n  - [x] nested done\n  - [ ] nested todo with spaces   \n- [X] uppercase done\n",
      markdownAdapter,
    );

    const tasks = document.tasks();
    expect(tasks.length).toBe(4);
    expect(taskLabels(tasks)).toEqual(["top task", "nested done", "nested todo with spaces", "uppercase done"]);
    expect(taskChecked(tasks)).toEqual([false, true, false, true]);
  });

  test("outline() reports heading depths and text, while links() includes links inside list items", () => {
    const document = openDocument(
      "# Top [ignored link text](https://heading.example)\n\nIntro with [home](https://example.test).\n\n- item with [nested](./nested.md) link\n\n### Deep heading\n",
      markdownAdapter,
    );

    const outline = document.outline();
    expect(outline.map((entry) => [entry.depth, entry.text])).toEqual([
      [1, "Top ignored link text"],
      [3, "Deep heading"],
    ]);

    const links = document.links();
    expect(links.map((link) => [link.text, link.url])).toEqual([
      ["ignored link text", "https://heading.example"],
      ["home", "https://example.test"],
      ["nested", "./nested.md"],
    ]);
  });

  test("html documents are read-only for block replacement and task toggling", () => {
    const html = "<!doctype html><h1>Title</h1><ul><li><input type=\"checkbox\" checked> Done</li></ul>";
    const document = openDocument(html, htmlAdapter);
    const block = requireValue(document.blocks[0], "html block");
    const task = requireValue(document.tasks()[0], "html task");

    expect(document.writeback).toBe(false);
    expect(() => document.replaceBlock(block.id, "Replacement")).toThrow(/read-only/);
    expect(() => document.toggleTask(task)).toThrow(/read-only/);
  });

  test("resolveAdapter chooses markdown and html by extension or html head, falling back to markdown", () => {
    expect(resolveAdapter("notes.md", "# Title")).toBe(markdownAdapter);
    expect(resolveAdapter("page.html", "plain head is enough with extension")).toBe(htmlAdapter);
    expect(resolveAdapter("README", "<!doctype html><title>Doc</title>")).toBe(htmlAdapter);
    expect(resolveAdapter("README", "# Plain markdown without extension")).toBe(markdownAdapter);
  });

  test("replaceBlock marks structural changes only when the top-level block count changes", () => {
    const document = openDocument("First paragraph.\n\nSecond paragraph.\n", markdownAdapter);
    const first = requireValue(document.blocks[0], "first paragraph");

    const sameCount = document.replaceBlock(first.id, "First paragraph\nwrapped onto another source line.");
    expect(sameCount.next.text).toBe("First paragraph\nwrapped onto another source line.\n\nSecond paragraph.\n");
    expect(sameCount.delta.structural).toBe(false);
    expect(sameCount.delta.replaced.length).toBe(1);

    const split = document.replaceBlock(first.id, "First paragraph.\n\nInserted paragraph.");
    expect(split.next.text).toBe("First paragraph.\n\nInserted paragraph.\n\nSecond paragraph.\n");
    expect(split.delta.structural).toBe(true);
  });
});

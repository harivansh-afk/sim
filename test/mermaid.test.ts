import { describe, expect, test } from "bun:test";

import { renderMermaid, type MermaidArt } from "../src/view/mermaid.ts";

function renderOrThrow(source: string): MermaidArt {
  const art = renderMermaid(source);
  if (art === null) {
    throw new Error("expected mermaid flowchart to render");
  }
  return art;
}

function overLimitFlowchart(): string {
  const nodes: string[] = [];
  for (let index = 0; index < 25; index += 1) {
    nodes.push(`N${index}[Node ${index}]`);
  }
  return `flowchart LR\n${nodes.join(" --> ")}`;
}

function countChar(text: string, wanted: string): number {
  let count = 0;
  for (const char of text) {
    if (char === wanted) {
      count += 1;
    }
  }
  return count;
}

function countBoxCorners(text: string): number {
  // Boxes use rounded corners; square corners belong to edge routing.
  const corners: Record<string, true> = { "╭": true, "╮": true, "╰": true, "╯": true };
  let count = 0;
  for (const char of text) {
    if (corners[char] === true) {
      count += 1;
    }
  }
  return count;
}

function countSubstring(text: string, needle: string): number {
  if (needle.length === 0) {
    throw new Error("needle must not be empty");
  }

  let count = 0;
  let start = 0;
  while (start < text.length) {
    const index = text.indexOf(needle, start);
    if (index === -1) {
      return count;
    }
    count += 1;
    start = index + needle.length;
  }
  return count;
}

function renderedLineCount(text: string): number {
  let count = 1;
  for (const char of text) {
    if (char === "\n") {
      count += 1;
    }
  }
  return count;
}

describe("renderMermaid", () => {
  test("unsupported diagrams, prose, empty input, and over-large flowcharts return null", () => {
    const cases = [
      { name: "sequence diagram", source: "sequenceDiagram\nAlice->>Bob: Hello" },
      { name: "gantt", source: "gantt\ntitle Release" },
      { name: "pie", source: "pie\ntitle Pets\n\"dogs\" : 3" },
      { name: "empty input", source: "" },
      { name: "plain prose", source: "A paragraph about arrows without a mermaid header." },
      { name: "more than 24 nodes", source: overLimitFlowchart() },
    ];

    for (const entry of cases) {
      expect(renderMermaid(entry.source), entry.name).toBeNull();
    }
  });

  test("a simple left-to-right chain draws both boxed labels and one arrowhead", () => {
    const art = renderOrThrow("flowchart LR\nA[start] --> B[end]");

    expect(art.text).toContain("start");
    expect(art.text).toContain("end");
    expect(countChar(art.text, "►")).toBe(1);
    expect(countBoxCorners(art.text)).toBe(8);
  });

  test("edge labels are rendered on labeled arrows", () => {
    const art = renderOrThrow("flowchart LR\nA[Start] -->|yes| B[End]");

    expect(art.text).toContain("yes");
  });

  test("merged edges keep both source labels while sharing or retaining arrowheads", () => {
    const art = renderOrThrow("flowchart LR\nA[Alpha] --> C[Gamma]\nB[Beta] --> C");
    const arrowheads = countChar(art.text, "►");

    expect(art.text).toContain("Alpha");
    expect(art.text).toContain("Beta");
    expect([1, 2]).toContain(arrowheads);
  });

  test("multi-layer spans route below a single chain without dropping labels or arrowheads", () => {
    const singleChain = renderOrThrow("flowchart LR\nA[Alpha] --> B[Beta]");
    const span = renderOrThrow("flowchart LR\nA[Alpha] --> B[Beta] --> C[Gamma]\nA --> C");

    expect(span.text).toContain("Alpha");
    expect(span.text).toContain("Beta");
    expect(span.text).toContain("Gamma");
    expect(countChar(span.text, "►")).toBeGreaterThanOrEqual(2);
    expect(renderedLineCount(span.text)).toBeGreaterThan(renderedLineCount(singleChain.text));
  });

  test("non-left-to-right flowcharts report the rendered direction in a note", () => {
    const topDown = renderOrThrow("graph TD\nA --> B");
    const leftToRight = renderOrThrow("flowchart LR\nA --> B");

    expect(topDown.note).toContain("TD");
    expect(leftToRight.note).toBeNull();
  });

  test("later references reuse an earlier node label without duplicating the box", () => {
    const art = renderOrThrow("flowchart LR\nA[Label] --> B\nA --> C");

    expect(countSubstring(art.text, "Label")).toBe(1);
  });

  test("comments and styling directives are ignored without breaking the flowchart", () => {
    const art = renderOrThrow(
      "flowchart LR\n%% this line is only a comment\nA[Start] --> B[End]\nstyle A fill:#fff\nclassDef highlighted fill:#f9f\nclick A \"https://example.test\"\nclass A highlighted\nlinkStyle 0 stroke:#333",
    );

    expect(art.text).toContain("Start");
    expect(art.text).toContain("End");
    expect(countChar(art.text, "►")).toBe(1);
  });
});

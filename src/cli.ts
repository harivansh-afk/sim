#!/usr/bin/env bun
import { resolveAdapter } from "./document/adapters.ts";
import { openDocument } from "./document/store.ts";
import { FileSource } from "./source/file.ts";
import { runPager } from "./shell/pager.ts";

const USAGE = `usage: sim <file.md|file.html> [--plain]

Renders markdown and html in the terminal.
Interactive pager on a TTY; plain text when piped or with --plain.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const plain = args.includes("--plain");
  const path = args.find((a) => !a.startsWith("-"));
  const help = args.includes("--help") || args.includes("-h");
  if (!path || help) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(help ? 0 : 1);
  }

  if (plain || !process.stdout.isTTY) {
    // bat semantics when piped: emit plain text, no TUI, exit immediately.
    // For markdown this is the file byte-for-byte; for html it is the
    // converted markdown.
    const loaded = await new FileSource(path).load();
    const adapter = resolveAdapter(path, loaded.text.slice(0, 512));
    const doc = openDocument(loaded.text, adapter);
    process.stdout.write(doc.text.endsWith("\n") ? doc.text : `${doc.text}\n`);
    return;
  }

  await runPager(path);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`sim: ${message}\n`);
  process.exit(1);
});

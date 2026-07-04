# tui-notes (name TBD)

bat-like CLI: `<cmd> file.md` renders Markdown or HTML natively in the terminal.
Interactive pager when on a TTY, plain text when piped. Typst deferred past alpha.

## Stack (pinned)

| Piece | Version | Why pinned |
|---|---|---|
| Bun | 1.3.14 | Last Zig-based release; Rust rewrite (May 2026) ships Linux x64 first, ARM later |
| @opentui/core | 0.4.3 | Pre-1.0 API churn; 0.4.3 is current (Jul 3 2026) |
| Reconciler | @opentui/solid | Pick one, never abstract over it |
| Parsing | remark + remark-gfm, rehype + rehype-remark | unified ecosystem, positions preserved |

Node is not a target (node:ffi needs 26.1+ experimental flag). Ship via `bun build --compile`.

## Rendering stack (who does what, in what language)

```
file -> [TS] adapter (remark / rehype->remark) -> mdast blocks
     -> [TS] renderable tree (<markdown conceal>, <scrollbox>)
     -> [Zig] OpenTUI core: layout, cell compositing, damage diff
     -> ANSI escapes -> terminal
```

- OpenTUI core: Zig, exposed over a C ABI, called via Bun FFI
- Syntax highlighting in code blocks: tree-sitter (C)
- Layout: flexbox (Yoga model); native-side since OpenTUI 0.4.1
- Runtime under it all: Bun (Rust as of May 2026; 1.3.14 pin is the Zig build) + JavaScriptCore (C++)
- Our code: TypeScript only. Parsing cost is irrelevant at file scale; drawing is native.

## Hard problems (design is shaped around these)

1. Round-trip fidelity: edit one block (e.g. checkbox), write back, rest byte-identical.
2. Block identity: focus/scroll survive re-parses.
3. Dependency volatility: OpenTUI 0.x churn, Bun mid-migration.

## Modules

```
src/
  document/   DocumentStore: parse, block index, mutations, write-back
  source/     FileSource: atomic writes, watch, external-edit conflict detection
  view/       DocumentView: project -> reconcile-by-id -> block renderer registry
  shell/      keymap (OpenTUI keymap manager), command registry, pager chrome
  cli.ts      argv, TTY detection, mode select
```

Import rules (lint-enforced): `document/` and `source/` never import `@opentui/*`.
Only `view/` and `shell/` touch OpenTUI. Topology + pinning contains problem 3.

### Deep modules

- **DocumentStore** (deepest): hides format dispatch, mdast retention, positional
  write-back (source splicing, never whole-doc stringify), content-hash block IDs,
  change deltas. All round-trip bugs land here.
- **DocumentView**: hides reconciliation keyed by block ID, focus restoration,
  renderer selection. Edit mode = swap a block's `<markdown>` for `Textarea` (undo/redo free).
- **FileSource**: hides temp+rename atomic writes, versioning, stale-base save refusal,
  watch debounce, own-write echo suppression.

### Thin by decision (do not deepen)

- Format dispatch: adapter registry with `probe(path, head) -> confidence`. ~20 lines.
  No event bus, no plugin system. Typst later = push one adapter.
- HTML is read-only: the adapter omits `serialize`; nothing else ever checks format.
- No OpenTUI wrapper facade: churn is contained by topology, not indirection.

## Output modes

- TTY: full-screen pager (scrollbox, keymap, TOC jump, search)
- Piped/`--plain`: static ANSI to stdout, no raw mode, exits immediately (bat behavior)

## Invariant to test first (before any UI)

parse(text) -> replaceBlock(id, unchanged) -> serialize === text, byte-identical.
Property-test over a corpus of real-world markdown. If this holds, the rest is furniture.

E2E later via pilotty (scripted TUI automation).

## Weekend plan

- Sat AM: create-tui scaffold, markdown-in-scrollbox viewer from argv
- Sat PM: pager shell (j/k, search, TOC from headings), piped/plain mode
- Sun AM: block model, checkbox toggle with write-back, link follow
- Sun PM: HTML adapter (rehype -> remark, readonly); stretch: single-block Textarea editing

## Known risks

- rehype-remark fidelity on real-world HTML: first-hour smoke test
- `<markdown>` conceal quality on GFM extensions (tables, callouts): budget a normalize plugin
- Bun/OpenTUI churn: frozen lockfile for alpha, revisit at Bun 1.4 stable

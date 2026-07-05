# sim

`bat` for rich documents: render Markdown and HTML natively in the terminal,
with just enough interactivity to be useful. Built on OpenTUI's Zig-core
renderer.

```
sim notes.md           # interactive pager
sim page.html          # html, converted and readonly
sim notes.md --plain   # plain text to stdout (also when piped)
```

Rendering is concealed markdown: styled headings, bordered GFM tables,
tree-sitter highlighted code blocks, no visible `**markers**`. Mermaid
flowcharts are laid out natively as box-drawing diagrams (pure-TS engine in
`src/view/mermaid.ts`); other mermaid types fall back to highlighted code.

## Keys

| Key | Action |
|---|---|
| `j` / `k`, arrows | scroll line |
| `d` / `u`, `space`, pgup/pgdn | scroll page |
| `g` / `G` | top / bottom |
| `tab` / `shift-tab` | cycle task selection |
| `x` / `enter` | toggle selected checkbox (saves to disk) |
| `q`, `ctrl-c` | quit |

Checkbox toggles write back through a positional splice: only the 3-byte
marker changes, the rest of the file stays byte-identical. External edits
hot-reload; a save against a file that changed on disk is refused, never
clobbered.

## Architecture

```
src/
  document/   parse, block index, mutations, write-back   (imports: unified only)
  source/     atomic writes, versioning, watch            (imports: node:fs only)
  view/       per-block renderables reconciled by id      (imports: @opentui/*)
  shell/      pager keymap, save flow, status bar         (imports: @opentui/*)
  cli.ts      argv, TTY detection, mode select
```

- One document model: everything becomes mdast. Formats are adapters picked
  by a `probe()` confidence registry; HTML converts via rehype-remark once,
  then flows through the same pipeline with `writeback: false`.
- Blocks get content-hash ids, so identity (focus, highlight, scroll) survives
  the full re-parse that follows every edit.
- Core invariant, enforced by tests: `parse -> replaceBlock(same) -> text` is
  byte-identical, and toggling a checkbox twice restores the original bytes.
- `document/` and `source/` never import OpenTUI. Renderer churn stays in
  `view/` and `shell/`.

## Stack

| Piece | Version | Note |
|---|---|---|
| Bun | 1.3.14 (pinned) | last Zig-based release; revisit after the Rust rewrite stabilizes on ARM |
| @opentui/core | 0.4.3 (pinned) | Zig core over C ABI, tree-sitter highlighting, markdown conceal |
| unified | remark + rehype | parsing, positions preserved for splice write-back |

Node is not a target (`node:ffi` is still experimental). Distribution path is
`bun build --compile`.

## Install (dev)

```
bun install
ln -sfn "$PWD/src/cli.ts" ~/.local/bin/sim
```

`src/cli.ts` is executable with a `bun` shebang, so the symlink always runs
the checkout: pull or edit, and the next `sim` invocation is the new build.

## Development

```
bun install
bun test              # 14 tests: round-trip, identity, conflict refusal
bun x tsc --noEmit
```

## Status and roadmap

Alpha: viewer + checkbox write-back, md and html. Planned next: `/` search,
TOC jump from the heading outline, link follow, single-block Textarea editing,
compiled binary. Typst support is deferred: it needs its own adapter and there
is no terminal-native Typst renderer to lean on yet.

Known behavior: an uppercase `[X]` marker normalizes to `[x]` after a toggle
round-trip; the unchecked state cannot carry the case bit.

Syntax highlighting covers the grammars @opentui/core ships: typescript,
javascript, zig (plus markdown itself). Other languages render as unstyled
code blocks; runtime grammar download is a planned follow-up.

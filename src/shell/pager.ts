import {
  BoxRenderable,
  TextRenderable,
  createCliRenderer,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import { resolveAdapter } from "../document/adapters.ts";
import { openDocument } from "../document/store.ts";
import type { Document, TaskRef } from "../document/types.ts";
import { FileSource, type FileVersion } from "../source/file.ts";
import { createTheme, palette } from "../view/theme.ts";
import { DocumentView } from "../view/view.ts";

interface PagerState {
  doc: Document;
  version: FileVersion;
  tasks: readonly TaskRef[];
  /** Index into tasks, or -1 when no task is selected. */
  selected: number;
  notice: string;
}

/**
 * The interactive mode: full-screen pager over one file. Owns the renderer
 * lifecycle, the keymap, the save flow, and external-change reloads. All
 * document knowledge stays behind Document/DocumentView.
 */
export async function runPager(path: string): Promise<void> {
  const source = new FileSource(path);
  const loaded = await source.load();
  const adapter = resolveAdapter(path, loaded.text.slice(0, 512));

  const state: PagerState = {
    doc: openDocument(loaded.text, adapter),
    version: loaded.version,
    tasks: [],
    selected: -1,
    notice: "",
  };
  state.tasks = state.doc.tasks();

  const renderer: CliRenderer = await createCliRenderer({});
  const theme = createTheme();
  const view = new DocumentView(renderer, theme);

  const frame = new BoxRenderable(renderer, {
    width: "100%",
    height: "100%",
    flexDirection: "column",
  });
  const status = new TextRenderable(renderer, {
    width: "100%",
    height: 1,
    content: "",
    fg: palette.statusFg,
    bg: palette.statusBg,
  });
  frame.add(view.scroll);
  frame.add(status);
  renderer.root.add(frame);
  view.mount(state.doc);

  const refreshStatus = () => {
    const name = state.doc.writeback ? path : `${path} [readonly]`;
    const selectedTask = state.selected >= 0 ? state.tasks[state.selected] : undefined;
    const task = selectedTask ? ` | task: ${selectedTask.label.slice(0, 40)}` : "";
    const notice = state.notice ? ` | ${state.notice}` : "";
    status.content = ` ${name} | ${view.scrollPercent()}%${task}${notice} | q quit  j/k scroll  tab task  x toggle`;
    renderer.requestRender();
  };

  const selectTask = (step: number) => {
    if (state.tasks.length === 0) {
      state.notice = "no tasks in document";
      refreshStatus();
      return;
    }
    // Cycle through -1 (none), 0 .. count-1, back to -1.
    const moved = state.selected + step;
    const count = state.tasks.length;
    state.selected = moved >= count ? -1 : moved < -1 ? count - 1 : moved;
    const ref = state.selected >= 0 ? state.tasks[state.selected] : undefined;
    view.highlight(ref ? ref.blockId : null);
    state.notice = "";
    refreshStatus();
  };

  const applyDocument = (doc: Document, version: FileVersion, notice: string) => {
    state.doc = doc;
    state.version = version;
    state.tasks = doc.tasks();
    state.selected = Math.min(state.selected, state.tasks.length - 1);
    state.notice = notice;
    view.mount(doc);
    const ref = state.selected >= 0 ? state.tasks[state.selected] : undefined;
    view.highlight(ref ? ref.blockId : null);
    refreshStatus();
  };

  const toggleSelected = async () => {
    const ref = state.selected >= 0 ? state.tasks[state.selected] : undefined;
    if (!ref) {
      state.notice = "no task selected (tab to select)";
      refreshStatus();
      return;
    }
    if (!state.doc.writeback) {
      state.notice = "read-only document";
      refreshStatus();
      return;
    }
    const { next, delta } = state.doc.toggleTask(ref);
    const saved = await source.save(next.text, state.version);
    if (!saved.ok) {
      const reloaded = await source.load();
      applyDocument(
        openDocument(reloaded.text, adapter),
        reloaded.version,
        "file changed on disk, reloaded (toggle not applied)",
      );
      return;
    }
    state.doc = next;
    state.version = saved.version;
    state.tasks = next.tasks();
    state.notice = "saved";
    view.applyEdit(next, delta);
    const selectedRef = state.selected >= 0 ? state.tasks[state.selected] : undefined;
    view.highlight(selectedRef ? selectedRef.blockId : null);
    refreshStatus();
  };

  const unwatch = source.watch((changed) => {
    applyDocument(openDocument(changed.text, adapter), changed.version, "reloaded from disk");
  });

  const quit = () => {
    unwatch();
    renderer.destroy();
    process.exit(0);
  };

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) return quit();
    switch (key.name) {
      case "j":
      case "down":
        view.scrollLines(1);
        break;
      case "k":
      case "up":
        view.scrollLines(-1);
        break;
      case "d":
      case "pagedown":
      case "space":
        view.scrollPage(1);
        break;
      case "u":
      case "pageup":
        view.scrollPage(-1);
        break;
      case "g":
        if (key.shift) view.scrollToBottom();
        else view.scrollToTop();
        break;
      case "home":
        view.scrollToTop();
        break;
      case "end":
        view.scrollToBottom();
        break;
      case "tab":
        selectTask(key.shift ? -1 : 1);
        return;
      case "x":
      case "return":
        void toggleSelected();
        return;
      default:
        return;
    }
    state.notice = "";
    refreshStatus();
  });

  refreshStatus();
  renderer.auto();
}

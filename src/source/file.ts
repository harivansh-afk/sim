import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

/** Version of file content as last seen by this process. */
export interface FileVersion {
  readonly mtimeMs: number;
  readonly sha256: string;
}

export interface LoadedFile {
  readonly text: string;
  readonly version: FileVersion;
}

export type SaveResult =
  | { readonly ok: true; readonly version: FileVersion }
  | { readonly ok: false; readonly reason: "conflict" };

export type WatchCallback = (loaded: LoadedFile) => void;
export type Unsubscribe = () => void;

const WATCH_DEBOUNCE_MS = 80;

/**
 * All disk I/O for one file. Hides atomic writes (temp + rename), version
 * hashing, stale-base conflict refusal, watch debouncing, and suppression of
 * change events echoed back from our own saves.
 */
export class FileSource {
  private lastWrittenHash: string | null = null;

  constructor(readonly path: string) {}

  async load(): Promise<LoadedFile> {
    const [text, info] = await Promise.all([
      readFile(this.path, "utf8"),
      stat(this.path),
    ]);
    return {
      text,
      version: {
        mtimeMs: info.mtimeMs,
        sha256: createHash("sha256").update(text).digest("hex"),
      },
    };
  }

  /**
   * Refuses to write when the file on disk no longer matches `base`
   * (external edit since our load): the caller reloads and reapplies
   * instead of clobbering someone else's changes.
   */
  async save(text: string, base: FileVersion): Promise<SaveResult> {
    const current = await this.load();
    if (current.version.sha256 !== base.sha256) {
      return { ok: false, reason: "conflict" };
    }
    const dir = await mkdtemp(join(tmpdir(), "sim-"));
    const tmp = join(dir, basename(this.path));
    try {
      await writeFile(tmp, text, "utf8");
      await rename(tmp, this.path);
    } catch {
      // Cross-device tmpdir: fall back to a sibling temp file, same rename.
      const sibling = join(dirname(this.path), `.${basename(this.path)}.sim-tmp`);
      await writeFile(sibling, text, "utf8");
      await rename(sibling, this.path);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    const saved = await this.load();
    this.lastWrittenHash = saved.version.sha256;
    return { ok: true, version: saved.version };
  }

  /** Debounced change notifications, excluding echoes of our own saves. */
  watch(onChange: WatchCallback): Unsubscribe {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let watcher: FSWatcher | null = null;
    const fire = () => {
      timer = null;
      void this.load().then((loaded) => {
        if (loaded.version.sha256 === this.lastWrittenHash) return;
        onChange(loaded);
      });
    };
    try {
      watcher = watch(this.path, () => {
        clearTimeout(timer ?? undefined);
        timer = setTimeout(fire, WATCH_DEBOUNCE_MS);
      });
    } catch {
      // Watching is best-effort (some filesystems refuse); viewing still works.
    }
    return () => {
      clearTimeout(timer ?? undefined);
      watcher?.close();
    };
  }
}

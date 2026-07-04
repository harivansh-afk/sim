import { afterEach, describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileSource } from "../src/source/file.ts";

const tempRoots: string[] = [];

afterEach(async () => {
  const roots = tempRoots.splice(0);
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileSource", () => {
  test("load returns file text and a content hash that changes with bytes on disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tn-file-source-test-"));
    tempRoots.push(dir);
    const path = join(dir, "note.md");
    const source = new FileSource(path);

    await writeFile(path, "# First\nbody\n", "utf8");
    const first = await source.load();

    await writeFile(path, "# First\nchanged body\n", "utf8");
    const second = await source.load();

    expect(first.text).toBe("# First\nbody\n");
    expect(second.text).toBe("# First\nchanged body\n");
    expect(second.version.sha256).not.toBe(first.version.sha256);
  });

  test("save with the loaded version writes text and returns the version later observed by load", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tn-file-source-test-"));
    tempRoots.push(dir);
    const path = join(dir, "note.md");
    const source = new FileSource(path);

    await writeFile(path, "original\n", "utf8");
    const loaded = await source.load();
    const saved = await source.save("replacement\n", loaded.version);

    if (!saved.ok) {
      throw new Error("save should not conflict when the base version still matches disk");
    }

    expect(await readFile(path, "utf8")).toBe("replacement\n");
    expect(saved.version).toEqual((await source.load()).version);
  });

  test("save refuses a stale base and leaves the external edit intact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tn-file-source-test-"));
    tempRoots.push(dir);
    const path = join(dir, "note.md");
    const source = new FileSource(path);

    await writeFile(path, "base\n", "utf8");
    const loaded = await source.load();
    await writeFile(path, "external edit\n", "utf8");

    const result = await source.save("local overwrite\n", loaded.version);

    expect(result).toEqual({ ok: false, reason: "conflict" });
    expect(await readFile(path, "utf8")).toBe("external edit\n");
  });

  test("save preserves exact UTF-8 bytes including trailing whitespace without adding a newline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tn-file-source-test-"));
    tempRoots.push(dir);
    const path = join(dir, "note.md");
    const source = new FileSource(path);
    const exact = "line with trailing spaces   \n\tindented trailing tab\t";

    await writeFile(path, "old\n", "utf8");
    const loaded = await source.load();
    const saved = await source.save(exact, loaded.version);

    if (!saved.ok) {
      throw new Error("save should not conflict for an unchanged base version");
    }

    expect(await readFile(path)).toEqual(Buffer.from(exact, "utf8"));
  });

  test("a save can be followed by another save using the returned version", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tn-file-source-test-"));
    tempRoots.push(dir);
    const path = join(dir, "note.md");
    const source = new FileSource(path);

    await writeFile(path, "first\n", "utf8");
    const loaded = await source.load();
    const firstSave = await source.save("second\n", loaded.version);

    if (!firstSave.ok) {
      throw new Error("first save should not conflict when based on the loaded version");
    }

    const secondSave = await source.save("third\n", firstSave.version);

    if (!secondSave.ok) {
      throw new Error("second save should accept the version returned by the first save");
    }

    expect(await readFile(path, "utf8")).toBe("third\n");
    expect(secondSave.version).toEqual((await source.load()).version);
  });
});

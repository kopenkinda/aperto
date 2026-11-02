import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LibraryStore } from "./storage";

describe("library file", () => {
  it("takes up outside edits, but not its own writes or a half-written file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "aperto-store-"));
    try {
      const store = new LibraryStore(directory);
      await store.load();
      await store.update((state) => ({ ...state, terminal: "com.apple.Terminal" }));
      expect(await store.reloadIfEdited()).toBe(false);
      const edited = JSON.parse(await readFile(store.file, "utf8"));
      edited.terminal = "com.mitchellh.ghostty";
      await writeFile(store.file, "{ not json");
      expect(await store.reloadIfEdited()).toBe(false);
      expect(store.value.terminal).toBe("com.apple.Terminal");
      await writeFile(store.file, JSON.stringify(edited));
      expect(await store.reloadIfEdited()).toBe(true);
      expect(store.value.terminal).toBe("com.mitchellh.ghostty");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

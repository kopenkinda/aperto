import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { listComponents, removeComponent } from "./components";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "aperto-components-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function writeFiles(files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await writeFile(path.join(directory, name), content);
  }
}

it("lists downloads with their sizes and removes only listed ones", async () => {
  await writeFiles({
    "renpy/8.6.0/.installed": "py3-mac-universal",
    "renpy/8.6.0/renpy.py": "x".repeat(1000),
    // A release without an Apple Silicon build keeps only an empty marker and is not listed.
    "renpy/7.3.5/.installed": "",
    "mkxp-z/app/.installed": "",
    "mkxp-z/rtp/RPGVXAce/.installed": "",
    "mkxp-z/data/0d6a3c0e-0000-4000-8000-000000000000/keys.json": "{}",
    "runtimes/0.117.0/nwjs": "",
    "legendary-client/0.21.1/legendary": "",
    // Legendary's sign-in, not a download.
    "legendary/user.json": "{}",
  });
  const list = await listComponents(directory);
  expect(list.map((item) => [item.id, item.name])).toEqual([
    ["renpy/8.6.0", "Ren'Py 8.6.0"],
    ["mkxp-z/app", "mkxp-z"],
    ["mkxp-z/rtp/RPGVXAce", "RPG Maker VX Ace RTP"],
    ["legendary-client/0.21.1", "Legendary 0.21.1"],
  ]);
  expect(list[0]!.size).toBeGreaterThanOrEqual(1000);
  await removeComponent(directory, "renpy/8.6.0");
  expect((await listComponents(directory)).map((item) => item.id)).not.toContain("renpy/8.6.0");
  await expect(removeComponent(directory, "runtimes/0.117.0")).rejects.toThrow("no longer there");
});

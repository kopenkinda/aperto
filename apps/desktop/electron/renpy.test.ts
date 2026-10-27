import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findGames } from "./discovery";
import { inspectRenpy, renpyNeeds } from "./renpy";

let directory: string;
beforeEach(async () => {
  directory = await realpath(await mkdtemp(path.join(tmpdir(), "aperto-renpy-")));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function writeFiles(root: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
}

describe("Ren'Py games", () => {
  it("finds a PC build by its launcher script, ahead of its .exe and Mac app", async () => {
    const root = path.join(directory, "Moonlit_Garden-1.2-pc");
    await writeFiles(root, {
      "MoonlitGarden.py": "",
      "MoonlitGarden.exe": "",
      "MoonlitGarden.sh": "",
      "renpy/__init__.py": "",
      "game/script.rpyc": "",
      "MoonlitGarden.app/Contents/Info.plist": "<plist/>",
    });
    const { games } = await findGames(directory);
    expect(games).toEqual([
      expect.objectContaining({
        kind: "renpy",
        root,
        executable: path.join(root, "MoonlitGarden.py"),
        artwork: path.join(root, "MoonlitGarden.exe"),
      }),
    ]);
    expect(await inspectRenpy(path.join(directory))).toBeNull();
  });

  it("reads the Python generation and the exact version of Ren'Py 8 builds", async () => {
    const eight = path.join(directory, "eight");
    await writeFiles(eight, {
      "renpy/__pycache__/vc_version.cpython-312.pyc": "ã\u0000\u000e8.5.2.26010301Ú\u0007version",
      "lib/py3-windows-x86_64/python.exe": "",
    });
    expect(await renpyNeeds(eight)).toEqual({ own: null, generation: 3, version: "8.5.2" });

    const seven = path.join(directory, "seven");
    await writeFiles(seven, {
      "renpy/vc_version.py": "vc_version = 6063\n",
      "lib/windows-i686/python.exe": "",
      "lib/py2-mac-universal/python": "",
    });
    expect(await renpyNeeds(seven)).toEqual({
      own: "py2-mac-universal",
      generation: 2,
      version: null,
    });
  });
});

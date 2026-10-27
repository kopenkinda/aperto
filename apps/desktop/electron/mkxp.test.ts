import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findGames } from "./discovery";
import { rgssGame } from "./mkxp";

let directory: string;
beforeEach(async () => {
  directory = await realpath(await mkdtemp(path.join(tmpdir(), "aperto-rgss-")));
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

describe("RPG Maker XP, VX and VX Ace games", () => {
  it("reads the RGSS version from the archive, the scripts or the library, and the RTP", async () => {
    const ace = path.join(directory, "ace");
    await writeFiles(ace, {
      "Game.exe": "",
      "Game.ini": "[Game]\r\nLibrary=System\\RGSS301.dll\r\nTitle=Ace\r\nRTP=RPGVXAce\r\n",
      "Game.rgss3a": "",
    });
    expect(await rgssGame(ace)).toEqual({ version: 3, rtp: "RPGVXAce", execName: "Game" });

    const xp = path.join(directory, "xp");
    await writeFiles(xp, {
      "Game.exe": "",
      "Game.ini": "[Game]\nLibrary=RGSS104E.dll\nScripts=Data\\Scripts.rxdata\nRTP1=\n",
      "Data/Scripts.rxdata": "",
    });
    expect(await rgssGame(xp)).toEqual({ version: 1, rtp: null, execName: "Game" });
  });

  it("adds RGSS games instead of Windows games and leaves WOLF RPG games to CrossOver", async () => {
    await writeFiles(path.join(directory, "Lantern Road"), {
      "Game.exe": "",
      "Game.ini": "[Game]\nLibrary=System\\RGSS202E.dll\nTitle=Lantern Road\nRTP=RPGVX\n",
      "Game.rgss2a": "",
    });
    await writeFiles(path.join(directory, "Wolf Game"), {
      "Game.exe": "",
      "Game.ini": "Start=0\nSoftModeFlag=0\n",
      "Data/BasicData.wolf": "",
    });
    const { games } = await findGames(directory);
    expect(games.map((game) => [game.kind, game.name])).toEqual([
      ["rgss", "Lantern Road"],
      ["windows", "Wolf Game"],
    ]);
  });
});

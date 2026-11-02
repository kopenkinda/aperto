import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { epicCode, epicInstall, epicOwnedGames } from "./epic";

let directory = "";
let binary = "";
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "aperto-epic-"));
  binary = path.join(directory, "legendary");
  // A stand-in for Legendary that answers `list` for each platform and fakes an `install`.
  await writeFile(
    binary,
    `#!/bin/sh
[ "$1" = "--yes" ] && shift
case "$1" in
  list)
    if [ "$4" = "Mac" ]; then
      echo '[{"app_name":"Fir","app_title":"Firewatch","metadata":{"developer":"Campo Santo","keyImages":[{"type":"DieselGameBox","url":"https://cdn1.epicgames.com/fir.jpg"}]}}]'
    else
      echo '[{"app_name":"Fir","app_title":"Firewatch"},{"app_name":"Sal","app_title":"Salt and Sanctuary"}]'
    fi ;;
  install)
    echo "[DLManager] INFO: = Progress: 42.50% (10/20), Running for 00:00:05, ETA: 00:00:07" >&2
    mkdir -p "$7/Firewatch" && echo game > "$7/Firewatch/Firewatch.exe" ;;
esac
`,
  );
  await chmod(binary, 0o755);
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("Epic", () => {
  it("lists owned games with the platforms each has", async () => {
    const games = await epicOwnedGames(binary, directory);
    expect(
      games.map(({ id, title, platforms, cover, author }) => ({
        id,
        title,
        platforms,
        cover,
        author,
      })),
    ).toEqual([
      {
        id: "Fir",
        title: "Firewatch",
        platforms: ["mac", "windows"],
        cover: "https://cdn1.epicgames.com/fir.jpg",
        author: "Campo Santo",
      },
      { id: "Sal", title: "Salt and Sanctuary", platforms: ["windows"], cover: null, author: "" },
    ]);
  });

  it("installs through Legendary and reports its progress", async () => {
    const reports: string[] = [];
    const base = path.join(directory, "base");
    const game = {
      site: "epic" as const,
      id: "Fir",
      gameId: "Fir",
      title: "Firewatch",
      page: "Fir",
      cover: null,
      author: "",
      platforms: [],
    };
    await epicInstall(
      binary,
      directory,
      game,
      base,
      "Windows",
      new AbortController().signal,
      (_, detail) => reports.push(detail),
    );
    expect(reports).toContain("42.50%, 00:00:07 left");
    expect(await readdir(base)).toEqual(["Firewatch"]);
  });
});

describe("Epic sign-in code", () => {
  it("reads the code from the address Epic redirects to", () => {
    expect(epicCode("https://localhost/launcher/authorized?code=abc123")).toBe("abc123");
    expect(epicCode("https://localhost/launcher/authorized")).toBeNull();
  });
});

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseUpload, ownedGames, unpack } from "./itch";

const execute = promisify(execFile);

/** Answers itch.io API calls from a table of paths. */
function stubApi(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = routes[new URL(url).pathname + new URL(url).search];
      return new Response(JSON.stringify(body ?? { errors: ["not found"] }), {
        status: body ? 200 : 404,
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("itch.io", () => {
  it("lists owned games and leaves out tools and soundtracks", async () => {
    stubApi({
      "/profile/owned-keys?page=1": {
        per_page: 50,
        owned_keys: [
          {
            id: 11,
            game: {
              id: 1,
              title: "Lust Quest",
              url: "https://dev.itch.io/lust-quest",
              classification: "game",
              cover_url: "https://img.itch.zone/a.png",
              user: { username: "dev", display_name: "Dev" },
              traits: ["p_windows", "p_osx"],
            },
          },
          {
            id: 12,
            game: {
              id: 2,
              title: "OST",
              url: "https://dev.itch.io/ost",
              classification: "soundtrack",
            },
          },
        ],
      },
    });
    expect(await ownedGames("key")).toEqual([
      {
        site: "itch",
        id: "11",
        gameId: "1",
        title: "Lust Quest",
        page: "dev.itch.io/lust-quest",
        cover: "https://img.itch.zone/a.png",
        author: "Dev",
        platforms: ["mac", "windows"],
      },
    ]);
  });

  it("downloads the Mac build first, then Windows, and skips demos", async () => {
    const game = {
      site: "itch" as const,
      id: "11",
      gameId: "1",
      title: "Lust Quest",
      page: "dev.itch.io/lust-quest",
      cover: null,
      author: "Dev",
      platforms: [],
    };
    stubApi({
      "/games/1/uploads?download_key_id=11": {
        uploads: [
          { id: 1, filename: "demo.zip", type: "default", traits: ["p_osx", "demo"] },
          { id: 2, filename: "win.zip", type: "default", traits: ["p_windows"] },
          { id: 3, filename: "ost.zip", type: "soundtrack", traits: [] },
          { id: 4, filename: "mac.zip", type: "default", p_osx: true },
        ],
      },
    });
    expect((await chooseUpload("key", game)).filename).toBe("mac.zip");
  });

  it("unpacks zip files and moves other files in as they are", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "aperto-itch-"));
    try {
      await mkdir(path.join(directory, "src", "Game"), { recursive: true });
      await writeFile(path.join(directory, "src", "Game", "Game.exe"), "exe");
      const zip = path.join(directory, "game.zip");
      await execute("/usr/bin/ditto", ["-c", "-k", path.join(directory, "src"), zip]);
      await unpack(zip, path.join(directory, "zip"));
      expect(await readFile(path.join(directory, "zip", "Game", "Game.exe"), "utf8")).toBe("exe");

      const exe = path.join(directory, "Setup.exe");
      await writeFile(exe, "setup");
      await unpack(exe, path.join(directory, "plain"));
      expect(await readFile(path.join(directory, "plain", "Setup.exe"), "utf8")).toBe("setup");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gogInstall, gogInstaller, gogOwnedGames, sizeOf } from "./gog";

const execute = promisify(execFile);

/** Answers GOG API calls from a table of paths and queries. */
function stubApi(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = routes[new URL(url).pathname + new URL(url).search];
      return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const game = {
  site: "gog" as const,
  id: "1",
  gameId: "1",
  title: "Old Game",
  page: "old_game",
  cover: null,
  author: "",
  platforms: [],
};

describe("GOG", () => {
  it("lists owned games across pages with their slugs, covers, and platforms", async () => {
    stubApi({
      "/account/getFilteredProducts?mediaType=1&sortBy=title&page=1": {
        totalPages: 2,
        products: [
          {
            id: 1,
            title: "Old Game",
            image: "//images-1.gog-statics.com/abc",
            url: "/en/game/old_game",
            worksOn: { Windows: true, Mac: true },
          },
        ],
      },
      "/account/getFilteredProducts?mediaType=1&sortBy=title&page=2": {
        totalPages: 2,
        products: [{ id: 2, title: "New Game", slug: "new_game", worksOn: { Windows: true } }],
      },
    });
    expect(await gogOwnedGames("token")).toEqual([
      {
        ...game,
        cover: "https://images-1.gog-statics.com/abc_196.jpg",
        platforms: ["mac", "windows"],
      },
      {
        ...game,
        id: "2",
        gameId: "2",
        title: "New Game",
        page: "new_game",
        platforms: ["windows"],
      },
    ]);
  });

  it("takes the English Mac installer first, and Windows only with CrossOver", async () => {
    const windows = [
      { manualUrl: "/downloads/old_game/en1installer0", size: "1 GB" },
      { manualUrl: "/downloads/old_game/en1installer1", size: "512 MB" },
    ];
    stubApi({
      "/account/gameDetails/1.json": {
        downloads: [
          ["Deutsch", { mac: [{ manualUrl: "/downloads/old_game/de2installer0" }] }],
          ["English", { windows }],
        ],
      },
    });
    expect(await gogInstaller("token", game, true)).toEqual({
      platform: "windows",
      files: windows,
    });
    await expect(gogInstaller("token", game, false)).rejects.toThrow(/CrossOver/);
    expect(windows.reduce((sum, file) => sum + sizeOf(file.size), 0)).toBe(1.5 * 1024 ** 3);
  });

  it.runIf(process.platform === "darwin")(
    "unpacks the app from a Mac installer package without installing it",
    async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "aperto-gog-"));
      try {
        const root = path.join(directory, "root");
        await mkdir(path.join(root, "Old Game.app", "Contents", "MacOS"), { recursive: true });
        await writeFile(path.join(root, "Old Game.app", "Contents", "MacOS", "game"), "game");
        const pkg = path.join(directory, "old_game.pkg");
        await execute("/usr/bin/pkgbuild", [
          "--root",
          root,
          "--identifier",
          "com.gog.oldgame",
          "--install-location",
          "/Applications",
          pkg,
        ]);
        const destination = path.join(directory, "game");
        await gogInstall("mac", [pkg], destination, null);
        expect(
          await readFile(
            path.join(destination, "Old Game.app", "Contents", "MacOS", "game"),
            "utf8",
          ),
        ).toBe("game");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});

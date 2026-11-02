import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownedAppIds, steamIdFromCookie, steamInstallState, steamOwnedGames } from "./steam";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Steam store", () => {
  it("reads owned apps from the store's user data, and knows a signed-out answer", () => {
    expect(ownedAppIds('{"rgOwnedApps":[10,20],"rgOwnedPackages":[1]}')).toEqual([10, 20]);
    expect(ownedAppIds('{"rgOwnedApps":[],"rgOwnedPackages":[]}')).toBe(null);
    expect(ownedAppIds(null)).toBe(null);
    expect(steamIdFromCookie("76561197960287930%7C%7CeyJhbGciOi")).toBe("76561197960287930");
  });

  it("names owned games with their platforms and art, leaving out apps that are not games", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              response: {
                store_items: [
                  {
                    appid: 20,
                    name: "Zeta",
                    type: 0,
                    platforms: { windows: true },
                    assets: { asset_url_format: "steam/apps/20/${FILENAME}", header: "h.jpg" },
                  },
                  { appid: 10, name: "Alpha", type: 0, platforms: { windows: true, mac: true } },
                  { appid: 30, name: "Alpha Soundtrack", type: 4 },
                ],
              },
            }),
          ),
      ),
    );
    const games = await steamOwnedGames([10, 20, 30]);
    expect(
      games.map(({ id, title, platforms, cover }) => ({ id, title, platforms, cover })),
    ).toEqual([
      { id: "10", title: "Alpha", platforms: ["mac", "windows"], cover: null },
      {
        id: "20",
        title: "Zeta",
        platforms: ["windows"],
        cover: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/20/h.jpg",
      },
    ]);
  });

  it("follows an install through its manifest in any library", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "aperto-steam-"));
    try {
      const library = path.join(directory, "Library");
      await mkdir(path.join(library, "steamapps"), { recursive: true });
      const manifest = (flags: number, received: number) =>
        writeFile(
          path.join(library, "steamapps", "appmanifest_10.acf"),
          `"AppState"\n{\n\t"appid"\t\t"10"\n\t"StateFlags"\t\t"${flags}"\n\t"BytesToDownload"\t\t"2000"\n\t"BytesDownloaded"\t\t"${received}"\n}\n`,
        );
      const libraries = [path.join(directory, "Empty"), library];
      expect(await steamInstallState(libraries, "10")).toBe(null);
      await manifest(1026, 500);
      expect(await steamInstallState(libraries, "10")).toEqual({
        done: false,
        received: 500,
        total: 2000,
      });
      await manifest(4, 2000);
      expect((await steamInstallState(libraries, "10"))?.done).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

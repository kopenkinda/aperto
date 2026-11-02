import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { macSteamGames } from "./mac";

/** A bare app bundle with an executable, as `inspectMacApp` needs. */
async function app(location: string, name: string) {
  await mkdir(path.join(location, "Contents", "MacOS"), { recursive: true });
  await writeFile(path.join(location, "Contents", "MacOS", name), "");
  await writeFile(
    path.join(location, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>${name}</string></dict></plist>`,
  );
}

async function manifest(library: string, appId: string, name: string, flags = 4) {
  await mkdir(path.join(library, "steamapps"), { recursive: true });
  await writeFile(
    path.join(library, "steamapps", `appmanifest_${appId}.acf`),
    `"AppState"\n{\n\t"appid"\t\t"${appId}"\n\t"name"\t\t"${name}"\n\t"StateFlags"\t\t"${flags}"\n\t"installdir"\t\t"${name}"\n}\n`,
  );
}

describe.runIf(process.platform === "darwin")("Mac Steam", () => {
  it("finds installed Mac games in every Steam library and links them to Steam", async () => {
    const directory = await realpath(await mkdtemp(path.join(tmpdir(), "aperto-steam-")));
    try {
      const steam = path.join(directory, "Steam");
      const external = path.join(directory, "External");
      await mkdir(path.join(steam, "steamapps"), { recursive: true });
      await writeFile(
        path.join(steam, "steamapps", "libraryfolders.vdf"),
        `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${external}"\n\t}\n}\n`,
      );
      await manifest(steam, "10", "Space Game");
      // A crash reporter beside the game, which the game's own app wins over.
      await app(path.join(steam, "steamapps", "common", "Space Game", "Reporter.app"), "Reporter");
      await app(
        path.join(steam, "steamapps", "common", "Space Game", "SpaceGame.app"),
        "SpaceGame",
      );
      await manifest(external, "20", "Deep");
      await app(path.join(external, "steamapps", "common", "Deep", "Mac", "Deep.app"), "Deep");
      // Still downloading.
      await manifest(steam, "30", "Later", 1026);
      await app(path.join(steam, "steamapps", "common", "Later", "Later.app"), "Later");

      const games = await macSteamGames(steam);
      expect(
        games.map(({ name, executable, steamAppId, kind }) => ({
          name,
          executable,
          steamAppId,
          kind,
        })),
      ).toEqual([
        {
          name: "Space Game",
          executable: path.join(steam, "steamapps", "common", "Space Game", "SpaceGame.app"),
          steamAppId: "10",
          kind: "mac",
        },
        {
          name: "Deep",
          executable: path.join(external, "steamapps", "common", "Deep", "Mac", "Deep.app"),
          steamAppId: "20",
          kind: "mac",
        },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, realpath } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Schema } from "effect";
import type { Candidate } from "../src/model";
import { meaningfulName } from "./detection";
import { exists } from "./storage";
import { readableName } from "./windows";

const execute = promisify(execFile);
const InfoSchema = Schema.Record(Schema.String, Schema.Unknown);
const isString = Schema.is(Schema.String);
// Bundles that ship beside a game but are not the game.
const helpers = /(?:^|[ _-])(?:uninstall(?:er)?|install(?:er)?|setup|updater|crash\w*)(?=$|[ _-])/i;

/** Reads an app's Info.plist in any of its formats (XML, binary, or JSON). */
export async function bundleInfo(app: string): Promise<Record<string, unknown> | null> {
  try {
    const { stdout } = await execute("/usr/bin/plutil", [
      "-convert",
      "json",
      "-o",
      "-",
      path.join(app, "Contents", "Info.plist"),
    ]);
    return Schema.decodeUnknownSync(InfoSchema)(JSON.parse(stdout));
  } catch {
    return null;
  }
}

/** A native macOS game bundle. NW.js bundles are found earlier and run with Aperto's runtime. */
export async function inspectMacApp(selected: string): Promise<Candidate | null> {
  if (!/\.app$/i.test(selected) || helpers.test(path.basename(selected, ".app"))) return null;
  const app = await realpath(selected);
  const info = await bundleInfo(app);
  const binary = info?.CFBundleExecutable;
  if (!isString(binary) || !(await exists(path.join(app, "Contents", "MacOS", binary))))
    return null;
  const parent = meaningfulName(readableName(path.basename(path.dirname(app))));
  const name =
    meaningfulName(info?.CFBundleDisplayName) ??
    meaningfulName(info?.CFBundleName) ??
    (parent?.includes(" ") ? parent : null) ??
    path.basename(app, ".app");
  const icon = isString(info?.CFBundleIconFile)
    ? path.join(
        app,
        "Contents",
        "Resources",
        info.CFBundleIconFile.endsWith(".icns")
          ? info.CFBundleIconFile
          : `${info.CFBundleIconFile}.icns`,
      )
    : null;
  return {
    kind: "mac",
    // The bundle is its own folder, so several apps side by side stay separate games.
    folder: app,
    root: app,
    executable: app,
    name,
    confirmed: true,
    artwork: icon && (await exists(icon)) ? icon : null,
  };
}

/** Converts an app's .icns icon to a PNG that the artwork importer accepts. */
export async function iconToPng(icns: string): Promise<string | null> {
  const output = path.join(tmpdir(), `aperto-icon-${randomUUID()}.png`);
  try {
    await execute("/usr/bin/sips", ["-s", "format", "png", "-Z", "512", icns, "--out", output]);
    return output;
  } catch {
    return null;
  }
}

// Apps that launch other games; their games are added on their own where Aperto can run them.
const launchers =
  /^(?:aperto|xenolauncher|steam|crossover|epic games launcher|gog galaxy|battle\.net|itch|heroic|playcover|whisky|porting kit|wineskin)/i;

/** The folders apps are installed in, where games are found by their App Store category. */
export const applicationFolders = ["/Applications", path.join(homedir(), "Applications")];

/**
 * Games installed as apps outside the games folder: apps in the Applications folders, or one
 * folder down, whose Info.plist files them under games, such as Factorio. Game launchers are left
 * out. CrossOver's own launchers in `~/Applications/CrossOver` are not games.
 */
export async function applicationGames(): Promise<Candidate[]> {
  const apps: string[] = [];
  for (const folder of applicationFolders) {
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const location = path.join(folder, entry.name);
      if (/\.app$/i.test(entry.name)) apps.push(location);
      else if (entry.isDirectory() && !/^(?:crossover|utilities)$/i.test(entry.name))
        for (const inner of await readdir(location).catch(() => [] as string[]))
          if (/\.app$/i.test(inner)) apps.push(path.join(location, inner));
    }
  }
  const games: Candidate[] = [];
  for (const app of apps) {
    if (launchers.test(path.basename(app, ".app"))) continue;
    const category = (await bundleInfo(app))?.LSApplicationCategoryType;
    if (!isString(category) || !/^public\.app-category\.(?:[a-z-]+-)?games$/.test(category))
      continue;
    const game = await inspectMacApp(app).catch(() => null);
    if (game) games.push(game);
  }
  return games;
}

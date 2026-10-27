import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { Candidate } from "../src/model";
import { applicationRoots, inspectFolder } from "./detection";
import { inspectMacApp } from "./mac";
import { inspectRenpy } from "./renpy";
import { inspectWindows } from "./windows";
import { digest, exists, message } from "./storage";

const MAX_DEPTH = 5;
const MAX_FOLDERS = 5000;
const skipped = /^(?:\.|node_modules$|__MACOSX$)/;
// Folder names Aperto creates or that never carry a version, such as `app.nw` and `www`.
const containers = /^(?:www|package\.nw|app\.nw|resources|contents|game)$/i;
// `v1.0.4`, `ver1.03`, `1.18c`, `Build.14407700`, `2026-01-31`. A bare number such as `072` is not
// a version, because folder names often start with a catalogue or project number.
const versionPattern =
  /(?<![a-z0-9])(?:(?:v|ver|version|build|rev)[ ._-]?)?(\d+(?:\.\d+)+[a-z]?|\d{4}-\d{2}-\d{2})(?![0-9])|(?<![a-z0-9])(?:v|ver|version|build|rev)[ ._-]?(\d+[a-z]?)(?![0-9])/gi;

export function versionsIn(segments: string[]): string[] {
  const versions = new Set<string>();
  for (const segment of segments) {
    if (containers.test(segment)) continue;
    for (const match of segment.matchAll(versionPattern))
      versions.add((match[1] ?? match[2]!).toLowerCase());
  }
  return [...versions].sort();
}

/** Adds the folder's version to a title that lacks it, so separate versions can be told apart. */
export function versionedName(name: string, folder: string, scanRoot: string): string {
  const segments = path.relative(scanRoot, folder).split(path.sep);
  const missing = versionsIn(segments).filter((version) => !name.toLowerCase().includes(version));
  const version = missing.find((item) => item.includes(".")) ?? missing.at(-1);
  return version ? `${name} v${version}` : name;
}

/**
 * Identifies one copy of a game. Two folders are duplicates when the detected name, the version
 * written in their folder names, and the game's own manifest and RPG Maker system data all match.
 * MV/MZ editors rewrite `System.json` on every save, so separate releases differ even when their
 * folders carry no version. A different folder version keeps two copies apart regardless of content.
 */
export async function fingerprint(game: Candidate): Promise<string> {
  const read = (file: string) => readFile(file).catch(() => Buffer.alloc(0));
  if (game.kind === "mac") {
    const segments = path.dirname(game.root).split(path.sep).slice(-2);
    return digest(
      JSON.stringify([
        game.name.toLowerCase(),
        versionsIn(segments),
        digest(await read(path.join(game.root, "Contents", "Info.plist"))),
      ]),
    );
  }
  if (game.executable) {
    // Windows builds are too large to hash; the executable's name and size stand in for content.
    const size = (await stat(game.executable).catch(() => null))?.size ?? 0;
    const segments = game.folder.split(path.sep).slice(-3);
    return digest(
      JSON.stringify([
        game.name
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, " ")
          .trim(),
        versionsIn(segments),
        path.basename(game.executable).toLowerCase(),
        size,
      ]),
    );
  }
  const segments = game.root.split(path.sep).slice(-4, -1).concat(path.basename(game.root));
  return digest(
    JSON.stringify([
      game.name
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim(),
      versionsIn(segments),
      digest(await read(path.join(game.root, "package.json"))),
      digest(await read(path.join(game.root, "data", "System.json"))),
      digest(await read(path.join(game.root, "www", "data", "System.json"))),
    ]),
  );
}

async function isGameFolder(folder: string) {
  for (const root of applicationRoots(folder))
    if (await exists(path.join(root, "package.json"))) return true;
  return false;
}

/**
 * Walks `scanRoot` and returns one candidate per game folder. The walk stops descending at a game,
 * so a game's own `www` or bundled `app.nw` is never reported as a second game.
 */
export async function findGames(
  scanRoot: string,
): Promise<{ games: Candidate[]; problems: string[] }> {
  const games: Candidate[] = [];
  const problems: string[] = [];
  const visited = new Set<string>();
  const queue: { folder: string; depth: number }[] = [
    { folder: await realpath(scanRoot), depth: 0 },
  ];
  while (queue.length && visited.size < MAX_FOLDERS) {
    const { folder, depth } = queue.shift()!;
    const real = await realpath(folder).catch(() => null);
    if (!real || visited.has(real)) continue;
    visited.add(real);
    if (await isGameFolder(real)) {
      const review = await inspectFolder(real).catch((error) => ({
        game: null,
        problems: [`${real}: ${message(error)}`],
      }));
      if (review.game?.confirmed) games.push(review.game);
      else if (!review.game) problems.push(...review.problems);
      continue;
    }
    // NW.js games run natively, so a folder is only treated as a Windows game without one.
    // NW.js games run with Aperto's runtime, so a bundle is only a Mac game without one. Nothing
    // inside an app bundle is a separate game.
    // A Ren'Py build also holds a Windows .exe and sometimes a Mac app, all for the same game.
    const renpy = await inspectRenpy(real).catch(() => null);
    if (renpy) {
      games.push(renpy);
      continue;
    }
    if (/\.app$/i.test(real)) {
      const mac = await inspectMacApp(real).catch(() => null);
      if (mac) games.push(mac);
      continue;
    }
    const windows = await inspectWindows(real).catch(() => null);
    if (windows) {
      games.push(windows);
      continue;
    }
    if (depth >= MAX_DEPTH) continue;
    const entries = await readdir(real, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name)))
      if ((entry.isDirectory() || entry.isSymbolicLink()) && !skipped.test(entry.name))
        queue.push({ folder: path.join(real, entry.name), depth: depth + 1 });
  }
  return { games, problems };
}

export const within = (child: string, parent: string) =>
  child === parent || child.startsWith(parent + path.sep);

/** The game in one folder: an NW.js game if there is one, else a Windows game. */
export async function detectGame(folder: string): Promise<Candidate | null> {
  return (
    (await inspectFolder(folder).catch(() => null))?.game ??
    (await inspectRenpy(folder).catch(() => null)) ??
    (await inspectMacApp(folder).catch(() => null)) ??
    inspectWindows(folder).catch(() => null)
  );
}

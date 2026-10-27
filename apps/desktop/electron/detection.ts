import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { Schema } from "effect";
import type { Candidate } from "../src/model";
import { atomicWrite, exists, message } from "./storage";

const RecordSchema = Schema.Record(Schema.String, Schema.Unknown);
const isRecord = Schema.is(RecordSchema);
const isString = Schema.is(Schema.String);
const placeholders =
  /^(?:game(?:[ _-]?\d+)?|rmmv|rmmz|nwjs|nw|node-webkit|www|app|package|index|project\d*|untitled|contents|resources|downloads|desktop|documents|games|bin|binaries|win32|win64|x64|x86)$/i;

export function meaningfulName(value: unknown): string | null {
  if (!isString(value)) return null;
  const name = value.trim().replace(/\.(?:exe|app|nw)$/i, "");
  if (
    !name ||
    name.length > 160 ||
    placeholders.test(name) ||
    /^[a-z]+(?:\.[a-z0-9_-]+){2,}$/i.test(name)
  )
    return null;
  return name;
}

export async function readObject(file: string): Promise<Record<string, unknown>> {
  if ((await stat(file)).size > 4 * 1024 * 1024) throw new Error("Metadata is larger than 4 MB.");
  return Schema.decodeUnknownSync(RecordSchema)(JSON.parse(await readFile(file, "utf8")));
}

export async function localFile(root: string, relative: string): Promise<string> {
  if (path.isAbsolute(relative) || /^[a-z][a-z0-9+.-]*:/i.test(relative))
    throw new Error("The application entry must be a local file.");
  const resolved = await realpath(path.resolve(root, relative));
  if (!resolved.startsWith(`${root}${path.sep}`))
    throw new Error("The application entry points outside its folder.");
  if (!(await stat(resolved)).isFile()) throw new Error("The application entry is not a file.");
  return resolved;
}

export async function inspectRoot(folder: string, candidateRoot: string): Promise<Candidate> {
  const root = await realpath(candidateRoot);
  const manifest = await readObject(path.join(root, "package.json"));
  // NW.js also needs a name, but games often ship without one; `nameManifest` adds it at launch.
  if (!isString(manifest.main) || !manifest.main.trim()) {
    throw new Error("package.json needs a local main entry.");
  }
  const mainPath = decodeURIComponent(manifest.main.split(/[?#]/)[0]!);
  await localFile(root, mainPath);
  const window = isRecord(manifest.window) ? manifest.window : {};
  // Deployed MV games keep their data beside the main page, often in `www`, not beside the manifest.
  const app = path.join(root, path.dirname(mainPath));
  const system = await readObject(path.join(app, "data", "System.json")).catch(
    () => ({}) as Record<string, unknown>,
  );
  const confirmed =
    /\.html?$/i.test(mainPath) ||
    (await exists(path.join(app, "js", "rpg_core.js"))) ||
    (await exists(path.join(app, "js", "rmmz_core.js"))) ||
    (await exists(path.join(folder, "nw.dll"))) ||
    (await exists(path.join(folder, "nw_elf.dll"))) ||
    (folder.endsWith(".app") && root.endsWith("app.nw"));
  let name =
    meaningfulName(system.gameTitle) ??
    meaningfulName(window.title) ??
    meaningfulName(manifest.name);
  if (!name) {
    const folders = [root, folder, path.dirname(folder)];
    for (const location of folders) {
      if (location === homedir() || location === path.parse(location).root) break;
      name = meaningfulName(path.basename(location));
      if (name) break;
    }
  }
  const artwork = isString(window.icon)
    ? await localFile(root, window.icon).catch(() => null)
    : null;
  return { kind: "nwjs", executable: null, folder, root, name: name ?? "", confirmed, artwork };
}

/**
 * NW.js refuses a package.json without a name, which RPG Maker exports often leave empty. This
 * gives it one from the game's name, changing only that value in the file.
 */
export async function nameManifest(root: string, gameName: string): Promise<void> {
  const file = path.join(root, "package.json");
  const manifest = await readObject(file);
  if (isString(manifest.name) && manifest.name.trim()) return;
  const name =
    gameName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "game";
  // Filling in the empty value keeps the file as it was; a nested "name" could match first, so
  // the result is checked and the whole file rewritten otherwise.
  const edited = (await readFile(file, "utf8")).replace(
    /("name"\s*:\s*)""/,
    `$1${JSON.stringify(name)}`,
  );
  const next =
    (JSON.parse(edited) as Record<string, unknown>).name === name
      ? edited
      : JSON.stringify({ ...manifest, name }, null, 2);
  await atomicWrite(file, next, (await stat(file)).mode & 0o777);
}

export const applicationRoots = (folder: string) => [
  folder,
  path.join(folder, "www"),
  path.join(folder, "package.nw"),
  path.join(folder, "Contents", "Resources", "app.nw"),
];

/**
 * Finds the game in one folder. Deployed MV games often ship both a root and a `www`
 * manifest for the same game, so the first valid root in `applicationRoots` order wins.
 */
export async function inspectFolder(
  selected: string,
): Promise<{ game: Candidate | null; problems: string[] }> {
  const folder = await realpath(selected);
  const problems: string[] = [];
  for (const root of applicationRoots(folder)) {
    if (!(await exists(path.join(root, "package.json")))) continue;
    try {
      return { game: await inspectRoot(folder, root), problems };
    } catch (error) {
      problems.push(`${path.relative(folder, root) || folder}: ${message(error)}`);
    }
  }
  return { game: null, problems };
}

import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { Schema } from "effect";
import type { Candidate, ImportReview } from "../src/model";
import { exists, message } from "./storage";

const RecordSchema = Schema.Record(Schema.String, Schema.Unknown);
const isRecord = Schema.is(RecordSchema);
const isString = Schema.is(Schema.String);
const placeholders =
  /^(?:game(?:[ _-]?\d+)?|nwjs|nw|node-webkit|www|app|package|index|project\d*|untitled|contents|resources|downloads|desktop|documents|games)$/i;

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
  if (
    !isString(manifest.main) ||
    !manifest.main.trim() ||
    !isString(manifest.name) ||
    !manifest.name.trim()
  ) {
    throw new Error("package.json needs a name and a local main entry.");
  }
  const mainPath = decodeURIComponent(manifest.main.split(/[?#]/)[0]!);
  await localFile(root, mainPath);
  const window = isRecord(manifest.window) ? manifest.window : {};
  const system = await readObject(path.join(root, "data", "System.json")).catch(
    () => ({}) as Record<string, unknown>,
  );
  const mv = await exists(path.join(root, "js", "rpg_core.js"));
  const mz = await exists(path.join(root, "js", "rmmz_core.js"));
  const evidence: string[] = [];
  if (mv || mz) evidence.push(mz ? "RPG Maker MZ application" : "RPG Maker MV application");
  if (
    (await exists(path.join(folder, "nw.dll"))) ||
    (await exists(path.join(folder, "nw_elf.dll")))
  )
    evidence.push("NW.js distribution files");
  if (folder.endsWith(".app") && root.endsWith("app.nw")) evidence.push("NW.js application bundle");
  const warnings: string[] = [];
  if (!evidence.length)
    warnings.push(
      "This has a compatible manifest, but NW.js could not be confirmed. Only add it if you recognize this game.",
    );
  if (manifest["chromium-args"])
    warnings.push(
      `The game supplies its own launch flags: ${String(manifest["chromium-args"]).slice(0, 1000)}. Aperto cannot remove those flags.`,
    );
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
  return { token: randomUUID(), folder, root, name: name ?? "", evidence, warnings, artwork };
}

export async function inspectFolder(selected: string): Promise<ImportReview> {
  const folder = await realpath(selected);
  const roots = [
    folder,
    path.join(folder, "www"),
    path.join(folder, "package.nw"),
    path.join(folder, "Contents", "Resources", "app.nw"),
  ];
  const review: ImportReview = { candidates: [], problems: [] };
  const seen = new Set<string>();
  for (const root of roots) {
    if (!(await exists(path.join(root, "package.json")))) continue;
    try {
      const candidate = await inspectRoot(folder, root);
      if (!seen.has(candidate.root)) review.candidates.push(candidate);
      seen.add(candidate.root);
    } catch (error) {
      review.problems.push(
        `${path.relative(folder, root) || "Selected folder"}: ${message(error)}`,
      );
    }
  }
  if (!review.candidates.length && !review.problems.length)
    review.problems.push(
      "No unpacked NW.js application was found. Select a folder containing package.json, a www folder, or an unpacked NW.js app. Archives and installers are not supported.",
    );
  return review;
}

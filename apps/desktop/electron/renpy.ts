import { readdir, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { compareVersions, type Candidate } from "../src/model";
import { meaningfulName } from "./detection";
import { installOnce } from "./downloads";
import { openRemoteZip } from "./remote-zip";
import { extractZip } from "./runtimes";
import { exists } from "./storage";
import { readableName } from "./windows";

// The newest release of each Python generation. Ren'Py runs games made with older releases of
// its generation, so these stand in when a game's own version is unknown or has no Apple Silicon
// build. Ren'Py 7 runs Python 2 games, Ren'Py 8 Python 3 ones.
const newest = { 2: "7.8.7", 3: "8.6.0" } as const;
const appleSilicon = /^(?:py[23]-)?mac-universal$/;

/**
 * Finds a Ren'Py game in one folder: the `renpy` engine and `game` folders beside the launcher
 * script, which shares its name with the game's .exe or .sh.
 */
export async function inspectRenpy(selected: string): Promise<Candidate | null> {
  const folder = await realpath(selected);
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  const folders = new Set(
    entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  );
  if (!folders.has("renpy") || !folders.has("game")) return null;
  const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  const scripts = [...files]
    .filter((name) => name.endsWith(".py"))
    .map((name) => name.slice(0, -3));
  const base =
    scripts.find((name) => files.has(`${name}.exe`) || files.has(`${name}.sh`)) ??
    (scripts.length === 1 ? scripts[0] : undefined);
  if (!base) return null;
  const icon = path.join(folder, "game", "gui", "window_icon.png");
  return {
    kind: "renpy",
    executable: path.join(folder, `${base}.py`),
    folder,
    root: folder,
    name: meaningfulName(readableName(base)) ?? readableName(path.basename(folder)),
    confirmed: true,
    artwork: files.has(`${base}.exe`)
      ? path.join(folder, `${base}.exe`)
      : (await exists(icon))
        ? icon
        : null,
  };
}

/**
 * What a Ren'Py game needs to run: an Apple Silicon build it ships itself, or else its Python
 * generation and, when it records one, its exact Ren'Py version.
 */
export async function renpyNeeds(root: string) {
  const lib = await readdir(path.join(root, "lib")).catch(() => [] as string[]);
  const cache = await readdir(path.join(root, "renpy", "__pycache__")).catch(() => [] as string[]);
  const python3 =
    cache.some((name) => /\.cpython-3\d+\.pyc$/.test(name)) ||
    lib.some((name) => /^(?:py3-|python3)/.test(name));
  // Ren'Py 8 builds keep `version = '8.5.2.26010301'` in compiled form; sources have it as text.
  const compiled = cache.find((name) => name.startsWith("vc_version."));
  const text = await readFile(
    compiled
      ? path.join(root, "renpy", "__pycache__", compiled)
      : path.join(root, "renpy", "vc_version.py"),
    "latin1",
  ).catch(() => "");
  const exact = /(?<![\d.])(\d+\.\d+\.\d+)\.\d+(?![\d.])/.exec(text)?.[1] ?? null;
  return {
    own: lib.find((name) => appleSilicon.test(name)) ?? null,
    generation: python3 ? (3 as const) : (2 as const),
    version: exact,
  };
}

export type RenpyLaunch = { runtime: string; folder: string; executable: string; args: string[] };

/** How to start a Ren'Py game, downloading the Ren'Py release it needs first. */
export async function renpyLaunch(
  directory: string,
  root: string,
  script: string,
  signal: AbortSignal,
): Promise<RenpyLaunch> {
  const needs = await renpyNeeds(root);
  if (needs.own) {
    const folder = path.join(root, "lib", needs.own);
    return { runtime: "Ren'Py", folder, executable: path.join(folder, "python"), args: [script] };
  }
  // Ren'Py 8 records its version; a release from before Apple Silicon builds falls back to the
  // newest of its generation.
  const versions = [needs.version, newest[needs.generation]].filter(
    (version): version is string =>
      !!version && (needs.generation === 3) === compareVersions(version, "8.0.0") >= 0,
  );
  for (const version of new Set(versions)) {
    const release = await renpyRelease(directory, version, signal);
    if (release)
      return {
        runtime: `Ren'Py ${version}`,
        folder: release.folder,
        executable: release.python,
        // The release's own engine runs the game folder, as the Ren'Py SDK runs its projects.
        args: [path.join(release.folder, "renpy.py"), root],
      };
  }
  throw new Error("No Ren'Py release for Apple Silicon could run this game.");
}

/**
 * A Ren'Py release's engine and Apple Silicon Python, downloaded once from renpy.org. Only those
 * parts of the SDK archive are fetched. Null when the release has no Apple Silicon build.
 */
async function renpyRelease(directory: string, version: string, signal: AbortSignal) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid Ren'Py version.");
  const folder = path.join(directory, "renpy", version);
  // The install records the Apple Silicon library folder; an empty record means there is none.
  const lib = await installOnce(folder, async (partial) => {
    let found = "";
    const zip = await openRemoteZip(
      `https://www.renpy.org/dl/${version}/renpy-${version}-sdk.zip`,
      signal,
    );
    await extractZip(zip, partial, (name) => {
      const match = /^[^/]+\/(renpy\.py|renpy\/.+|lib\/([^/]+)\/.*)$/.exec(name);
      if (!match) return null;
      const platform = match[2];
      if (platform && !appleSilicon.test(platform) && !/^python(?:lib)?[\d.]+$/.test(platform))
        return null;
      if (platform && appleSilicon.test(platform)) found = platform;
      return match[1]!;
    });
    if (found && !(await exists(path.join(partial, "lib", found, "python"))))
      throw new Error(`Ren'Py ${version} is missing its Python.`);
    // Nothing is kept of a release that cannot run here.
    if (!found) await rm(partial, { recursive: true, force: true });
    return found;
  });
  return lib ? { folder, python: path.join(folder, "lib", lib, "python") } : null;
}

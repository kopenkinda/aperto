import { execFile } from "node:child_process";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Candidate } from "../src/model";
import { meaningfulName } from "./detection";
import { exists } from "./storage";

const execute = promisify(execFile);

// Executables that ship next to a game but are not the game.
const helpers =
  /(?:^|[ _.-])(?:unins\d*|uninstall(?:er)?|setup|install(?:er)?|redist|vc_?redist\w*|dxsetup|dxwebsetup|crashhandler\w*|unitycrashhandler\w*|crashpad\w*|crashreport\w*|notification_helper|steamerrorreporter\w*|ue4prereqsetup\w*|uecrashreport\w*|python\w*|pythonw|zsync\w*|dotnet\w*|oalinst|7z\w*|unrar|winrar)(?=$|[ _.-])/i;
// Installer archives sit beside a setup program, as in `Game Installer-1.bin`.
const installerParts = /\.(?:bin|cab|msi)$/i;

async function isFile(file: string) {
  return stat(file).then(
    (info) => info.isFile(),
    () => false,
  );
}

/** Product name from a Unity build's `<Game>_Data/app.info` (company, then product). */
async function unityProduct(data: string): Promise<string | null> {
  const info = await readFile(path.join(data, "app.info"), "utf8").catch(() => "");
  return meaningfulName(info.split(/\r?\n/)[1]);
}

/**
 * Finds a Windows game in one folder, to be run through CrossOver. A Unity build is recognized by
 * `<Game>.exe` beside `<Game>_Data`; otherwise the folder needs one plausible game executable.
 */
/** Turns `Peeping.Dorm.Manager.Build.14407700` or `Rinas_Train-1.18c` into a plain title. */
export function readableName(folder: string): string {
  // Versions go first, while their dots still mark them as versions.
  let name = folder.replace(/_/g, " ").replace(versionWords, " ");
  if (!name.trim().includes(" ")) name = name.replace(/\./g, " ");
  return name
    .replace(releaseTags, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–]+|[\s\-–]+$/g, "")
    .trim();
}
// Release labels in download folder names, as in `HeMaidHerFall-0.9.7-mac-Compressed`.
const releaseTags =
  /(?:^|[\s\-(])(?:mac|macos|osx|pc|win|win64|compressed|full|final|repack)(?=$|[\s\-)])/gi;
const versionWords =
  /(?:^|[\s\-(])(?:v|ver|version|build|rev)?[ .]?(?:\d+(?:\.\d+)+[a-z]?|\d{4}-\d{2}-\d{2})(?=$|[\s\-)])|(?:^|[\s\-(])(?:v|ver|version|build|rev)[ .]?\d+[a-z]?(?=$|[\s\-)])/gi;

export async function inspectWindows(selected: string): Promise<Candidate | null> {
  const folder = await realpath(selected);
  // An .exe inside a Mac app bundle belongs to that app's own Wine wrapper.
  if (/\.app(?:\/|$)/i.test(folder)) return null;
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  const names = new Set(entries.map((entry) => entry.name.toLowerCase()));
  const executables = entries
    .filter((entry) => /\.exe$/i.test(entry.name) && !helpers.test(entry.name.slice(0, -4)))
    .map((entry) => entry.name);
  if (!executables.length) return null;
  if (entries.some((entry) => installerParts.test(entry.name)) && executables.length < 2) {
    // A lone executable beside installer parts is a setup program, even under another name.
    if (!names.has("unityplayer.dll")) return null;
  }

  let executable: string | undefined;
  let title: string | null = null;
  for (const name of executables) {
    const data = `${name.slice(0, -4)}_Data`;
    if (names.has(data.toLowerCase()) || names.has(data.toLowerCase().replace(/ /g, "_"))) {
      executable = name;
      title = await unityProduct(path.join(folder, data));
      break;
    }
  }
  if (!executable) {
    const sized = await Promise.all(
      executables.map(async (name) => ({
        name,
        size: (await stat(path.join(folder, name)).catch(() => null))?.size ?? 0,
      })),
    );
    // Prefer a name that matches the folder, then the largest executable: launchers and tools
    // are usually small, while the game binary carries the engine.
    const base = path
      .basename(folder)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    sized.sort(
      (a, b) =>
        Number(
          base.includes(
            b.name
              .slice(0, -4)
              .toLowerCase()
              .replace(/[^a-z0-9]/g, ""),
          ),
        ) -
          Number(
            base.includes(
              a.name
                .slice(0, -4)
                .toLowerCase()
                .replace(/[^a-z0-9]/g, ""),
            ),
          ) || b.size - a.size,
    );
    executable = sized[0]!.name;
  }
  const file = path.join(folder, executable);
  if (!(await isFile(file))) return null;

  // A readable folder name ("Lunar Mirror - The Pavilion of Desire") beats a squashed executable or
  // Unity product name ("Lunar MirrorThe Pavilion of Desire"). Versions are stripped here and added
  // back consistently by discovery.
  let name: string | null = null;
  for (const location of [folder, path.dirname(folder)]) {
    if (location === homedir() || location === path.parse(location).root) break;
    const readable = meaningfulName(readableName(path.basename(location)));
    if (readable?.includes(" ")) {
      name = readable;
      break;
    }
  }
  name ??= title;
  name ??= meaningfulName(executable);
  return {
    kind: "windows",
    folder,
    root: folder,
    executable: file,
    name: name ?? path.basename(folder),
    confirmed: true,
    // The icon is extracted from the executable on import.
    artwork: file,
  };
}

export const crossoverWine =
  "/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine";
export const bottlesDirectory = path.join(
  homedir(),
  "Library",
  "Application Support",
  "CrossOver",
  "Bottles",
);

export async function listBottles(): Promise<string[]> {
  const entries = await readdir(bottlesDirectory, { withFileTypes: true }).catch(() => []);
  const bottles: string[] = [];
  for (const entry of entries)
    if (
      entry.isDirectory() &&
      (await exists(path.join(bottlesDirectory, entry.name, "cxbottle.conf")))
    )
      bottles.push(entry.name);
  return bottles.sort((a, b) => a.localeCompare(b));
}

/** Whether a bottle's registry text turns on the Mac driver's high resolution (Retina) mode. */
export function retinaModeIn(registry: string): boolean {
  const header = registry.indexOf("[Software\\\\Wine\\\\Mac Driver]");
  if (header < 0) return false;
  const body = registry.slice(registry.indexOf("\n", header) + 1);
  // A section ends at a blank line or the next section's header.
  const section = body.split(/\n(?:\s*\n|\[)/)[0]!;
  const value = /^"RetinaMode"="([^"]*)"/m.exec(section);
  // Wine reads the first letter: y, t, or 1 means on.
  return !!value && /^[yt1]/i.test(value[1]!);
}

/**
 * Turns high resolution mode on or off for a whole bottle, as CrossOver's own bottle setting does.
 * Wine reads the setting once per bottle rather than per program, so it cannot be set for one
 * game alone. The saved registry is checked first so most launches skip starting Wine for it.
 */
export async function setRetinaMode(bottle: string, on: boolean) {
  const registry = await readFile(path.join(bottlesDirectory, bottle, "user.reg"), "utf8").catch(
    () => "",
  );
  if (retinaModeIn(registry) === on) return;
  await execute(
    crossoverWine,
    [
      "--bottle",
      bottle,
      "--no-update",
      "--no-gui",
      "--cx-app",
      "reg.exe",
      "add",
      "HKCU\\Software\\Wine\\Mac Driver",
      "/v",
      "RetinaMode",
      "/t",
      "REG_SZ",
      "/d",
      on ? "y" : "n",
      "/f",
    ],
    { timeout: 60_000 },
  ).catch(() => {
    throw new Error("CrossOver could not change the bottle's high resolution mode.");
  });
}

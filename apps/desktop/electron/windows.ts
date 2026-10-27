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

/**
 * Finds a Windows game in one folder, to be run through CrossOver. A Unity build is recognized by
 * `<Game>.exe` beside `<Game>_Data`; otherwise the folder needs one plausible game executable.
 */
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

/**
 * Arguments for CrossOver's wine to run something in a bottle. `--no-update` because updating a
 * bottle resyncs CrossOver's Mac launchers in ~/Applications/CrossOver, which macOS blocks as
 * Aperto modifying other apps; CrossOver upgrades its bottles itself when opened. A game keeps
 * winemenubuilder off so it cannot add shortcuts or file associations to the bottle and the Mac;
 * a tool, such as `taskkill.exe`, runs from the bottle without CrossOver's interface.
 */
export function wineArgs(bottle: string, args: readonly string[], run: "game" | "tool") {
  return [
    "--bottle",
    bottle,
    "--no-update",
    ...(run === "game" ? ["--dll", "winemenubuilder.exe=d"] : ["--no-gui", "--cx-app"]),
    ...args,
  ];
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
    wineArgs(
      bottle,
      [
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
      "tool",
    ),
    { timeout: 60_000 },
  ).catch(() => {
    throw new Error("CrossOver could not change the bottle's high resolution mode.");
  });
}

/** The `"key" "value"` pairs of a Steam manifest; nested sections are flattened. */
export function steamValues(text: string): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (const match of text.matchAll(/"([^"]+)"\s+"((?:[^"\\]|\\.)*)"/g)) {
    const key = match[1]!.toLowerCase();
    values.set(key, [...(values.get(key) ?? []), match[2]!.replace(/\\\\/g, "\\")]);
  }
  return values;
}

// Steam's own runtimes and redistributables have manifests too, but are not games.
const steamTools =
  /redistributable|steamworks|proton|steam linux runtime|directx|visual c\+\+|vc\+\+|dedicated server|soundtrack|sdk/i;

const tools =
  /editor|launcher|setup|config|crash|report|unins|redist|dxweb|vc_?redist|helper|updater/i;
const letters = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * The executable of a Steam install that stands for the game, for its icon and engine: not an
 * editor, launcher, or installer; the one named like the game, or else the largest. Steam starts
 * the game itself, so a wrong guess only affects the icon.
 */
async function mainExecutable(folder: string, name: string): Promise<string | null> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  const executables = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() && /\.exe$/i.test(entry.name) && !tools.test(entry.name.slice(0, -4)),
      )
      .map(async (entry) => ({
        file: path.join(folder, entry.name),
        named: letters(name).includes(letters(entry.name.slice(0, -4))),
        size: (await stat(path.join(folder, entry.name)).catch(() => null))?.size ?? 0,
      })),
  );
  executables.sort((a, b) => Number(b.named) - Number(a.named) || b.size - a.size);
  return executables[0]?.file ?? null;
}

/** A Windows path in a bottle as a Mac path, through the bottle's drive letters. */
async function bottlePath(bottle: string, windowsPath: string) {
  const match = /^([a-z]):[\\/](.*)$/i.exec(windowsPath);
  if (!match) return null;
  const drive = await realpath(
    path.join(bottlesDirectory, bottle, "dosdevices", `${match[1]!.toLowerCase()}:`),
  ).catch(() => null);
  return drive ? path.join(drive, ...match[2]!.split(/[\\/]+/)) : null;
}

/**
 * Games installed with Steam inside CrossOver bottles, read from each library's app manifests.
 * They launch through that bottle's Steam, so DRM and updates keep working.
 */
export async function bottleSteamGames(): Promise<Candidate[]> {
  const games: Candidate[] = [];
  for (const bottle of await listBottles()) {
    const drive = path.join(bottlesDirectory, bottle, "drive_c");
    for (const programs of ["Program Files (x86)", "Program Files"]) {
      const client = path.join(drive, programs, "Steam");
      if (!(await exists(path.join(client, "steam.exe")))) continue;
      const folders = await readFile(
        path.join(client, "steamapps", "libraryfolders.vdf"),
        "utf8",
      ).catch(() => "");
      const libraries = new Set([client]);
      for (const location of steamValues(folders).get("path") ?? []) {
        const library = await bottlePath(bottle, location);
        if (library) libraries.add(library);
      }
      for (const library of libraries) {
        const steamapps = path.join(library, "steamapps");
        const manifests = (await readdir(steamapps).catch(() => [] as string[])).filter((name) =>
          /^appmanifest_\d+\.acf$/.test(name),
        );
        for (const manifest of manifests) {
          const values = steamValues(
            await readFile(path.join(steamapps, manifest), "utf8").catch(() => ""),
          );
          const appId = values.get("appid")?.[0];
          const name = values.get("name")?.[0];
          const installdir = values.get("installdir")?.[0];
          // Flag 4 means fully installed; others mean downloading or uninstalled.
          const installed = (Number(values.get("stateflags")?.[0]) & 4) !== 0;
          if (!appId || !name || !installdir || !installed || steamTools.test(name)) continue;
          const folder = await realpath(path.join(steamapps, "common", installdir)).catch(
            () => null,
          );
          if (!folder) continue;
          const executable = await mainExecutable(folder, name);
          games.push({
            kind: "windows",
            folder,
            root: folder,
            executable,
            name,
            confirmed: true,
            artwork: executable,
            steam: { appId, bottle, installdir, client: path.join(client, "steam.exe") },
          });
        }
      }
    }
  }
  return games;
}

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Candidate } from "../src/model";
import { fetchPinned, installOnce } from "./downloads";
import { openRemoteZip } from "./remote-zip";
import { extractRuntime, extractZip } from "./runtimes";
import { atomicWrite, exists } from "./storage";
import { readableName } from "./windows";

/** RPG Maker XP, VX and VX Ace run Ruby scripts through RGSS 1, 2 and 3. */
export type Rgss = 1 | 2 | 3;
const rtpNames = { 1: "Standard", 2: "RPGVX", 3: "RPGVXAce" } as const;
const archives = { ".rgssad": 1, ".rgss2a": 2, ".rgss3a": 3 } as const;
const scripts = { ".rxdata": 1, ".rvdata": 2, ".rvdata2": 3 } as const;

/** The `Game.ini` settings of an RGSS game, case-insensitive as Windows reads them. */
async function readIni(file: string) {
  const text = await readFile(file, "latin1").catch(() => null);
  if (text === null) return null;
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([^=;[\s][^=]*?)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values.set(match[1]!.toLowerCase(), match[2]!);
  }
  return values;
}

/**
 * What an RGSS game needs: its RGSS version, the RTP it names in `Game.ini`, and the name of its
 * .exe and .ini, which mkxp-z reads settings by; and its title. Null for folders that are not RGSS games, such
 * as WOLF RPG games, which also have a `Game.ini`.
 */
export async function rgssGame(root: string) {
  const entries = await readdir(root).catch(() => [] as string[]);
  const ini = entries.find(
    (name) => /\.ini$/i.test(name) && entries.includes(`${name.slice(0, -4)}.exe`),
  );
  if (!ini) return null;
  const settings = await readIni(path.join(root, ini));
  const data = await readdir(path.join(root, "Data")).catch(() => [] as string[]);
  const extension = (name: string) => path.extname(name).toLowerCase();
  const version =
    entries.map((name) => archives[extension(name) as keyof typeof archives]).find(Boolean) ??
    data
      .filter((name) => /^scripts\./i.test(name))
      .map((name) => scripts[extension(name) as keyof typeof scripts])
      .find(Boolean) ??
    (Number(/RGSS(\d)/i.exec(settings?.get("library") ?? "")?.[1]) as Rgss | 0);
  if (!settings || !version || version > 3) return null;
  const named = [settings.get("rtp"), settings.get("rtp1")].find((value) => value?.trim());
  return {
    version: version as Rgss,
    rtp: named ? rtpNames[version as Rgss] : null,
    execName: ini.slice(0, -4),
    title: settings.get("title")?.trim() || null,
  };
}

/** Finds an RPG Maker XP, VX or VX Ace game, run natively with mkxp-z instead of CrossOver. */
export async function inspectRgss(selected: string): Promise<Candidate | null> {
  const folder = await realpath(selected);
  const game = await rgssGame(folder);
  if (!game) return null;
  return {
    kind: "rgss",
    executable: path.join(folder, `${game.execName}.ini`),
    folder,
    root: folder,
    name: game.title ?? readableName(path.basename(folder)),
    confirmed: true,
    artwork: path.join(folder, `${game.execName}.exe`),
  };
}

// m5kro's universal mkxp-z build, which Xenolauncher uses too; upstream only publishes CI
// artifacts. GitHub records each release file's SHA-256, and downloads are checked against it.
const release = "https://api.github.com/repos/m5kro/mkxp-z/releases/tags/launcher";

async function releaseAsset(name: string, signal: AbortSignal) {
  const response = await fetch(release, {
    headers: { Accept: "application/vnd.github+json" },
    signal,
  }).catch(() => null);
  if (!response?.ok) throw new Error("Could not reach GitHub to download mkxp-z. Try again.");
  const { assets } = (await response.json()) as {
    assets: { name: string; browser_download_url: string; digest?: string | null }[];
  };
  const asset = assets.find((item) => item.name === name);
  const digest = /^sha256:([a-f0-9]{64})$/.exec(asset?.digest ?? "")?.[1];
  if (!asset || !digest) throw new Error(`The mkxp-z release has no verifiable ${name}.`);
  return { url: asset.browser_download_url, digest };
}

/** Downloads a release file into `file`, checking it against GitHub's recorded digest. */
async function downloadAsset(name: string, file: string, signal: AbortSignal) {
  const asset = await releaseAsset(name, signal);
  const response = await fetch(asset.url, { signal });
  if (!response.ok || !response.body) throw new Error(`Could not download ${name}.`);
  const hash = createHash("sha256");
  await pipeline(
    Readable.fromWeb(response.body as never),
    async function* (source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        hash.update(chunk);
        yield chunk;
      }
    },
    createWriteStream(file, { flags: "wx", mode: 0o644 }),
  );
  if (hash.digest("hex") !== asset.digest)
    throw new Error(`The downloaded ${name} did not match its published checksum.`);
}

// Kawariki's preload scripts stand in for Windows-only calls many games make, as on Linux. They
// are GPL-3.0, so Aperto downloads them at a pinned commit rather than shipping them.
const kawarikiCommit = "bb5ea9a79d5ca358c6f6bb8b3c31524beb29c7b4";
const kawarikiFiles = {
  "preload.rb": "c6384a7080c435ac9ca0852327c7fe21253d41a6530867070211caf32a624efd",
  "patches.rb": "0f49bb6eff423cfa5368604fc4cf58536e3f9627429360904a30aa0d0c7ee210",
  "versions.json": "a5b555b4d2a5cd0c338470482f9873f6b72f11f1a92de8afb2a29e248b56de55",
  "libs/PreloadIni.rb": "e21dc682bf8cd97ba9c55b11fcfb4d0924415585c70f475afee2504002203889",
  "libs/Win32API.rb": "8f5bd219197f920ca53cbb63aca6ff2be6e0f08c982d5b386a5343d5b03e48b1",
  "libs/XP_TilemapOverrideLib.rb":
    "e8dfba8c78c782f3b01a5bcbd5ecb51b925f38741eb6dfcfd11268520db561fd",
  "libs/ruby18.rb": "66908b532f694a9f89a2e0b3882e7f905c729a68713d4d79e55b96145f4964af",
  "ports/CRDJ_Input.rb": "c38f81d5df264f5d02592dd800af010e44b22fc0459cb960861147c9d7fce5b8",
  "ports/Glitchfinder_Keyboard_Stub.rb":
    "9dc406057933bc3366aa34c2cc206676d9d2ee10524fbb58c9f47c80a5b09952",
  "ports/Mouse.rb": "68e3e2c17cb33333d714b64f27d8fea42487790ad2a4958a118e402f6d178320",
  "ports/TH_EventTriggerLabels.rb":
    "67491c42361a4ea83758598050d747454d674be59c014c516dae715d7d5438c9",
  "ports/TH_SimpleAudioEncryption.rb":
    "316f43e791000c64095cbf5c825ca0097dab6c45323dd0ed92bbf8dbd2e2234d",
  "ports/XP_CustomResolution.rb":
    "d922495a77add784161ee9f65fe6745c7bc1080bfdc3eb46d04215d44b955b1b",
  "ports/Zeus_Fullscreen++.rb": "f3c336b3d0cf4417ccc61f0bfbde486030c95b57b672752f7a49ca66ab1269c2",
};

async function mkxp(directory: string, signal: AbortSignal) {
  const folder = path.join(directory, "mkxp-z", "app");
  await installOnce(folder, async (partial) => {
    const archive = `${partial}.zip`;
    try {
      await downloadAsset("Z-universal.zip", archive, signal);
      await extractRuntime(archive, partial);
      await downloadAsset("GMGSx.SF2", path.join(partial, "GMGSx.sf2"), signal);
    } finally {
      await rm(archive, { force: true });
    }
    if (!(await exists(path.join(partial, "Z-universal.app", "Contents", "MacOS", "Z-universal"))))
      throw new Error("The mkxp-z download is missing its app.");
  });
  return folder;
}

async function kawariki(directory: string) {
  const folder = path.join(directory, "mkxp-z", "kawariki", kawarikiCommit);
  await installOnce(folder, async (partial) => {
    for (const [name, hash] of Object.entries(kawarikiFiles)) {
      const data = await fetchPinned(
        `https://raw.githubusercontent.com/Orochimarufan/Kawariki/${kawarikiCommit}/mkxp/${name}`,
        hash,
        "Kawariki script",
      );
      await atomicWrite(path.join(partial, name), data, 0o644);
    }
  });
  return folder;
}

/**
 * One RPG Maker RTP, the shared graphics and audio games are made with. Only that RTP's files
 * are read out of m5kro's RTP archive, without the Windows DLLs beside them.
 */
async function rtp(directory: string, name: (typeof rtpNames)[Rgss], signal: AbortSignal) {
  const folder = path.join(directory, "mkxp-z", "rtp", name);
  await installOnce(folder, async (partial) => {
    const zip = await openRemoteZip(
      "https://github.com/m5kro/mkxp-z/releases/download/launcher/RTP.zip",
      signal,
    );
    await extractZip(zip, partial, (entry) => {
      const match = /^RTP\/([^/]+)\/((?:Audio|Fonts|Graphics)\/.+)$/.exec(entry);
      return match?.[1] === name ? match[2]! : null;
    });
  });
  return folder;
}

// mkxp-z reads its settings only from inside its app bundle, so launches take turns writing them
// and each waits until the game before it has had time to read them.
let settingsTurn = Promise.resolve();

/**
 * Prepares mkxp-z to run one game: downloads mkxp-z, Kawariki's scripts and the game's RTP the
 * first time, and writes the game's settings. Call `started` once the game process is running.
 */
export async function mkxpLaunch(
  directory: string,
  gameId: string,
  root: string,
  signal: AbortSignal,
): Promise<{
  app: string;
  executable: string;
  read: string[];
  data: string;
  started: () => void;
}> {
  const game = await rgssGame(root);
  if (!game) throw new Error("This folder no longer holds an RPG Maker XP, VX or VX Ace game.");
  const [installed, scripts, assets] = await Promise.all([
    mkxp(directory, signal),
    kawariki(directory),
    game.rtp ? rtp(directory, game.rtp, signal) : null,
  ]);
  const app = path.join(installed, "Z-universal.app");
  // Saves go to the game folder. mkxp-z keeps its own settings per game in a folder it names
  // relative to Application Support; Aperto's data is there unless moved for testing.
  const support = path.join(homedir(), "Library", "Application Support");
  const relative = path.relative(support, path.join(directory, "mkxp-z", "data", gameId));
  const [org, ...appPath] =
    relative.startsWith("..") || path.isAbsolute(relative)
      ? ["Aperto", "mkxp-z", gameId]
      : relative.split(path.sep);
  const settings = {
    gameFolder: root,
    rgssVersion: game.version,
    execName: game.execName,
    RTP: assets ? [assets] : [],
    preloadScript: [path.join(scripts, "preload.rb")],
    midiSoundFont: path.join(installed, "GMGSx.sf2"),
    dataPathOrg: org,
    dataPathApp: appPath.join("/"),
  };
  let release!: () => void;
  const previous = settingsTurn;
  settingsTurn = new Promise((resolve) => (release = resolve));
  await previous;
  try {
    await writeFile(
      path.join(app, "Contents", "Game", "mkxp.json"),
      JSON.stringify(settings, null, 2),
    );
  } catch (error) {
    release();
    throw error;
  }
  return {
    app,
    executable: path.join(app, "Contents", "MacOS", "Z-universal"),
    read: [installed, scripts, ...(assets ? [assets] : [])],
    data: path.join(support, org!, ...appPath),
    started: () => void setTimeout(release, 3000),
  };
}

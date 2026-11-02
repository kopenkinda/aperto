import { execFile, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { OwnedGame, Platform } from "../src/model";
import { fetchPinned, installOnce } from "./downloads";

const execute = promisify(execFile);

/**
 * Epic's public launcher client, which Legendary and Heroic sign in with. Its redirect page shows
 * a one-time code that Legendary trades for a session.
 */
export const epicCodeUrl =
  "https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code";
export const epicLoginUrl = `https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(epicCodeUrl)}`;
export const epicSession = "persist:epic";

// Legendary's own macOS builds, pinned to their SHA-256 hashes.
export const legendaryVersion = "0.21.1";
const legendaryBuilds = {
  arm64: [
    "legendary_macOS_arm64",
    "d87978321dba9cb731fab40c72f0a30bed55baca8b5341ab21024c5733cd837e",
  ],
  x64: ["legendary_macOS_x64", "3dfab50277284b5bb0104f8710e4ff1d9ff00c992e44f5843fd0c977c5cc99c4"],
} as const;

/** Where Aperto keeps its copy of Legendary. */
export const legendaryPath = (directory: string) =>
  path.join(directory, "legendary-client", legendaryVersion, "legendary");

/**
 * Legendary, the open-source Epic client that downloads Epic's games, downloaded into Aperto's
 * folder the first time it is needed, as runtimes are.
 */
export async function legendaryBinary(directory: string) {
  const folder = path.dirname(legendaryPath(directory));
  await installOnce(folder, async (partial) => {
    const [name, hash] = legendaryBuilds[process.arch === "x64" ? "x64" : "arm64"];
    const data = await fetchPinned(
      `https://github.com/derrod/legendary/releases/download/${legendaryVersion}/${name}`,
      hash,
      "Legendary download",
      300_000,
    );
    await mkdir(partial, { recursive: true });
    await writeFile(path.join(partial, "legendary"), data, { mode: 0o755 });
  });
  return legendaryPath(directory);
}

/** Runs Legendary with Aperto's own config, so its sign-in is separate from any other setup. */
export function legendary(binary: string, config: string, args: string[]) {
  return execute(binary, args, {
    env: { ...process.env, LEGENDARY_CONFIG_PATH: config },
    maxBuffer: 64 * 1024 ** 2,
    timeout: 120_000,
  });
}

/** The account name Legendary is signed in as, or null when it is signed out. */
export async function epicAccount(binary: string, config: string) {
  const { stdout } = await legendary(binary, config, ["status", "--json", "--offline"]).catch(
    () => ({ stdout: "" }),
  );
  try {
    const account = (JSON.parse(stdout) as { account?: string }).account;
    return account && account !== "<not logged in>" ? account : null;
  } catch {
    return null;
  }
}

type ListedGame = {
  app_name: string;
  app_title: string;
  metadata?: { keyImages?: { type: string; url: string }[]; developer?: string };
};

/** The account's Epic games, with the Mac and Windows builds each has. DLC is left out. */
export async function epicOwnedGames(binary: string, config: string): Promise<OwnedGame[]> {
  const list = async (platform: string) => {
    const { stdout } = await legendary(binary, config, ["list", "--json", "--platform", platform]);
    return JSON.parse(stdout) as ListedGame[];
  };
  const [mac, windows] = await Promise.all([list("Mac"), list("Windows")]);
  const games = new Map<string, OwnedGame>();
  for (const [platform, listed] of [
    ["mac", mac],
    ["windows", windows],
  ] as const)
    for (const game of listed) {
      const known = games.get(game.app_name);
      if (known) {
        known.platforms.push(platform as Platform);
        continue;
      }
      const images = game.metadata?.keyImages ?? [];
      const cover =
        images.find((image) => image.type === "DieselGameBox")?.url ??
        images.find((image) => image.type === "OfferImageWide")?.url ??
        images[0]?.url ??
        null;
      games.set(game.app_name, {
        site: "epic",
        id: game.app_name,
        gameId: game.app_name,
        title: game.app_title,
        page: game.app_name,
        cover,
        author: game.metadata?.developer ?? "",
        platforms: [platform],
      });
    }
  return [...games.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Installs a game with Legendary into `base`, reporting the percentage Legendary prints. Stopping
 * ends Legendary, which picks up where it left off next time.
 */
export function epicInstall(
  binary: string,
  config: string,
  game: OwnedGame,
  base: string,
  platform: "Mac" | "Windows",
  signal: AbortSignal,
  progress: (fraction: number, detail: string) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      binary,
      // --yes is a global option, so it comes before the command.
      ["--yes", "install", game.id, "--skip-sdl", "--platform", platform, "--base-path", base],
      { env: { ...process.env, LEGENDARY_CONFIG_PATH: config }, stdio: ["ignore", "pipe", "pipe"] },
    );
    const abort = () => child.kill("SIGTERM");
    signal.addEventListener("abort", abort, { once: true });
    let output = "";
    const read = (chunk: Buffer) => {
      const text = chunk.toString();
      output = (output + text).slice(-4000);
      const percent = [...text.matchAll(/Progress: ([\d.]+)%/g)].pop()?.[1];
      const eta = [...text.matchAll(/ETA: ([\d:]+)/g)].pop()?.[1];
      if (percent) progress(Number(percent) / 100, `${percent}%${eta ? `, ${eta} left` : ""}`);
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.once("error", reject);
    child.once("exit", (code) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) return reject(signal.reason);
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Legendary could not install ${game.title}: ${output.trim().split("\n").pop()}`,
          ),
        );
    });
  });
}
